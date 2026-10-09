import { context } from "@opentelemetry/api";
import type { InboundAttachmentMeta, InboundEmailEvent } from "~/domain/email";
import { isReceiptFileType } from "~/domain/receipts";
import { bareMediaType } from "~/lib/utils";
import type { AllowedSendersService } from "~/server/allowed-senders/allowed-senders.service";
import type { BlobStore } from "~/server/blob-store/blob-store";
import type { Logger } from "~/server/observability/logging/logger";
import { BaggageKey, setBaggage } from "~/server/observability/tracing/baggage";
import type {
	ReceiptsService,
	StoredBlob,
} from "~/server/receipts/receipts.service";
import type { InboundMailbox } from "./email.mailbox";

/**
 * Bare lower-cased address, matching the shape the allowlist stores. `""` when the
 * header is not exactly one mailbox, so it matches no allowlist entry.
 */
export function parseFromAddress(from: string): string {
	// Quoted names and (comments) may legally hold `<…>`, so a sender could plant an
	// allowlisted address there. Skip them; only one real address may be left.
	const angled: string[] = [];
	let bare = "";
	let angleText: string | undefined;
	let quoted = false;
	let commentDepth = 0;
	for (let i = 0; i < from.length; i++) {
		const c = from[i];
		if ((quoted || commentDepth) && c === "\\") i++;
		else if (quoted) quoted = c !== '"';
		else if (commentDepth) commentDepth += c === "(" ? 1 : c === ")" ? -1 : 0;
		else if (angleText !== undefined) {
			if (c === ">") {
				angled.push(angleText);
				angleText = undefined;
			} else angleText += c;
		} else if (c === '"') quoted = true;
		else if (c === "(") commentDepth = 1;
		else if (c === "<") angleText = "";
		else bare += c;
	}
	const unclosed = quoted || commentDepth > 0 || angleText !== undefined;
	// A comma beside one <…> is part of an unquoted name; a second address is an `@`
	// outside the brackets, or a comma between bare addresses.
	const second =
		angled.length > 1 ||
		(angled.length ? bare.includes("@") : bare.includes(","));
	if (unclosed || second) return "";
	return (angled[0] ?? bare).trim().toLowerCase();
}

// Log the domain, never the address: the full from is a Member identifier, the
// domain is not. Undefined when there is no `@` so a malformed value never leaks.
function fromDomain(address: string): string | undefined {
	const at = address.lastIndexOf("@");
	return at === -1 ? undefined : address.slice(at + 1);
}

/**
 * Ceiling on how many attachments one email may mint. Each costs a download, a
 * blob write, a row and a Claude Vision call, and the trigger is an inbound
 * email — so the spend has to be bounded by something. No real forward carries
 * more than a handful.
 */
export const MAX_EMAIL_ATTACHMENTS = 10;

/** Whether an attachment is a receipt rather than part of the mail's furniture. */
export function isReceiptAttachment(a: InboundAttachmentMeta): boolean {
	if (!isReceiptFileType(a.content_type)) return false;
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
	allowedSenders: Pick<AllowedSendersService, "memberFor">;
	receipts: Pick<ReceiptsService, "createFromEmail">;
	mailbox: InboundMailbox;
	blobStore: Pick<BlobStore, "write">;
	logger: Logger;
}

/** Application tier for the Resend inbound webhook: allowlist gate, blob, mint. */
export class EmailService {
	private readonly allowedSenders: Pick<AllowedSendersService, "memberFor">;
	private readonly receipts: Pick<ReceiptsService, "createFromEmail">;
	private readonly mailbox: InboundMailbox;
	private readonly blobStore: Pick<BlobStore, "write">;
	private readonly logger: Logger;

	constructor({
		allowedSenders,
		receipts,
		mailbox,
		blobStore,
		logger,
	}: EmailServiceDeps) {
		this.allowedSenders = allowedSenders;
		this.receipts = receipts;
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
		const memberId = from
			? await this.allowedSenders.memberFor(from)
			: undefined;

		// Design decision 8: dropped, not quarantined — and dropped here, before any
		// fetch, blob write or model call, so unknown mail costs nothing.
		if (!memberId) {
			const reason = from ? "unknown sender" : "unreadable sender";
			this.logger.info(`inbound email dropped: ${reason}`, {
				"email.id": event.data.email_id,
				"email.from_domain": fromDomain(from),
			});
			return { status: "dropped" };
		}

		// Member on baggage so the blob writes, the mint and their logs carry who the
		// receipt is for. The inbound span opened earlier, so it never gets it.
		return context.with(
			setBaggage({ [BaggageKey.MemberId]: memberId }),
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

				const receiptIds = await this.receipts.createFromEmail(
					memberId,
					stored,
				);
				this.logger.info("inbound email ingested", {
					"email.id": event.data.email_id,
					"receipt.ids": receiptIds,
				});
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
				await this.store(bytes, bareMediaType(attachment.content_type)),
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
