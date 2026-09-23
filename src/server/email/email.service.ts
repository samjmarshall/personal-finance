import { context, trace } from "@opentelemetry/api";

import type { BlobStore } from "~/server/blob-store/blob-store";
import { BaggageKey, setBaggage } from "~/server/observability/baggage";
import { currentTraceId } from "~/server/observability/current-trace-id";
import type { Logger } from "~/server/observability/logger";
import type { InboundAttachmentMeta, InboundEmailEvent } from "./email.dto";
import type { InboundMailbox } from "./email.mailbox";
import type { EmailRepository, StoredBlob } from "./email.repository";

/** Bare lower-cased address, matching the shape the allowlist stores. */
export function parseFromAddress(from: string): string {
	// The LAST angle pair, never the first: RFC 5322 puts the addr-spec at the end
	// of a mailbox, and a quoted display name may legally contain angle brackets.
	// Taking the first pair lets `"<sam@allowed.com>" <attacker@evil.com>` file an
	// attacker's mail against an allowlisted member.
	const angled = [...from.matchAll(/<([^>]*)>/g)].at(-1);
	return (angled?.[1] ?? from).trim().toLowerCase();
}

// Log the domain, never the address: the full from is a Member identifier, the
// domain is not. Undefined when there is no `@` so a malformed value never leaks.
function fromDomain(address: string): string | undefined {
	const at = address.lastIndexOf("@");
	return at === -1 ? undefined : address.slice(at + 1);
}

// What the worker can actually extract from. Deliberately the same three types the
// image proxy will serve (`api/receipts/[id]/image/route.ts`).
const RECEIPT_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
]);

/**
 * Ceiling on how many attachments one email may mint. Each costs a download, a
 * blob write, a row and a Claude Vision call, and the trigger is an inbound
 * email — so the spend has to be bounded by something. No real forward carries
 * more than a handful.
 */
export const MAX_EMAIL_ATTACHMENTS = 10;

/** Whether an attachment is a receipt rather than part of the mail's furniture. */
export function isReceiptAttachment(a: InboundAttachmentMeta): boolean {
	if (!a.content_type || !RECEIPT_CONTENT_TYPES.has(a.content_type))
		return false;
	// Inline parts are the sender's signature image and the vendor's logo. They
	// pass the content-type check, so without this every branded e-receipt would
	// mint a junk Receipt per decoration.
	if (a.content_disposition === "inline") return false;
	if (a.content_id) return false;
	return true;
}

const BLOB_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"application/pdf": "pdf",
	"text/html": "html",
	"text/plain": "txt",
};

/**
 * Store-relative blob key. Server-generated so both read sinks — the worker's
 * read and the image proxy — stay pinned to a key we minted rather than to a
 * filename an untrusted sender chose.
 */
export function emailBlobPathname(contentType: string): string {
	const ext = BLOB_EXTENSIONS[contentType] ?? "bin";
	return `receipts/email/${crypto.randomUUID()}.${ext}`;
}

export type IngestResult =
	| { status: "dropped" }
	| { status: "empty" }
	| { status: "ingested"; receiptIds: number[] };

interface EmailServiceDeps {
	repository: EmailRepository;
	mailbox: InboundMailbox;
	blobStore: BlobStore;
	logger: Logger;
}

/** Application tier for the Resend inbound webhook: allowlist gate, blob, mint. */
export class EmailService {
	private readonly repository: EmailRepository;
	private readonly mailbox: InboundMailbox;
	private readonly blobStore: BlobStore;
	private readonly logger: Logger;

	constructor({ repository, mailbox, blobStore, logger }: EmailServiceDeps) {
		this.repository = repository;
		this.mailbox = mailbox;
		this.blobStore = blobStore;
		this.logger = logger;
	}

	/**
	 * `dropped` = unknown sender, `empty` = nothing to extract from; both are verdicts
	 * the controller answers 200 to. A throw (fetch, blob, commit) is left to surface.
	 */
	async ingest(event: InboundEmailEvent): Promise<IngestResult> {
		const from = parseFromAddress(event.data.from);
		const sender = await this.repository.findAllowedSender(from);

		// Design decision 8: dropped, not quarantined — and dropped here, before any
		// fetch, blob write or model call, so unknown mail costs nothing.
		if (!sender) {
			this.logger.info("inbound email dropped: unknown sender", {
				"email.id": event.data.email_id,
				"email.from_domain": fromDomain(from),
			});
			return { status: "dropped" };
		}

		// Member on baggage so the blob writes, the mint and the controller's
		// `email.inbound` span all carry who the receipt is for.
		return context.with(
			setBaggage({ [BaggageKey.MemberId]: sender.userId }),
			async (): Promise<IngestResult> => {
				const qualifying = event.data.attachments
					.filter(isReceiptAttachment)
					.slice(0, MAX_EMAIL_ATTACHMENTS);
				const stored = qualifying.length
					? await this.storeAttachments(event.data.email_id, qualifying)
					: await this.storeBody(event.data.email_id);

				if (!stored.length) {
					// Resend listed attachments the metadata promised and none came back.
					// Not worth a 5xx retry storm — the mail is still in Resend if it matters.
					if (qualifying.length)
						this.logger.warn("inbound email attachments resolved to nothing", {
							"email.id": event.data.email_id,
							"email.qualifying": qualifying.length,
						});
					return { status: "empty" };
				}

				const receiptIds = await this.repository.createPendingReceipts(
					sender.userId,
					stored,
					currentTraceId(),
				);
				this.logger.info("inbound email ingested", {
					"email.id": event.data.email_id,
					"receipt.ids": receiptIds,
				});
				trace.getActiveSpan()?.setAttribute("receipt.ids", receiptIds);
				return { status: "ingested", receiptIds };
			},
		);
	}

	// The webhook carries attachment metadata but no bytes, so the download URLs
	// are fetched here — they expire an hour after the event.
	private async storeAttachments(
		emailId: string,
		qualifying: InboundAttachmentMeta[],
	): Promise<StoredBlob[]> {
		const downloads = await this.mailbox.listAttachments(emailId);
		const byId = new Map(downloads.map((d) => [d.id, d]));
		const stored: StoredBlob[] = [];
		for (const attachment of qualifying) {
			const download = byId.get(attachment.id);
			if (!download) continue;
			const bytes = await this.mailbox.download(download.download_url);
			stored.push(
				await this.store(bytes, attachment.content_type ?? "application/pdf"),
			);
		}
		return stored;
	}

	// html carries the line-item table; text is the flattened fallback the sender's
	// mail client generated, so it loses structure the extractor wants.
	private async storeBody(emailId: string): Promise<StoredBlob[]> {
		const email = await this.mailbox.getBody(emailId);
		const html = email.html?.trim();
		const text = email.text?.trim();
		const body = html || text;
		// Nothing to extract from, so no row: a Receipt with an empty blob would only
		// ever reach the worker's failed state.
		if (!body) return [];
		return [await this.store(body, html ? "text/html" : "text/plain")];
	}

	private async store(
		body: string | Uint8Array,
		contentType: string,
	): Promise<StoredBlob> {
		const blob = await this.blobStore.write(
			emailBlobPathname(contentType),
			body,
			contentType,
		);
		return { blobUrl: blob.url, blobPathname: blob.pathname, contentType };
	}
}
