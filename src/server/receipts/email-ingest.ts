import { eq } from "drizzle-orm";
import { z } from "zod";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import {
	buildOutboxEvent,
	type OutboxEventDescriptor,
} from "~/server/inngest/events";

import { allowedSenders } from "./allowed-sender.schema";
import { receipts } from "./receipts.schema";

/**
 * The slice of Resend's `email.received` this module reads. Re-declared rather
 * than taken from the SDK's `EmailReceivedEvent` because it crosses the network:
 * the route parses an untrusted body against it, and an unexpected extra field
 * must not fail the parse.
 */
const inboundAttachmentSchema = z.object({
	id: z.string(),
	filename: z.string().nullish(),
	content_type: z.string().nullish(),
	content_disposition: z.string().nullish(),
	content_id: z.string().nullish(),
});

export const inboundEmailEventSchema = z.object({
	type: z.string(),
	data: z.object({
		email_id: z.string(),
		from: z.string(),
		attachments: z
			.array(inboundAttachmentSchema)
			.nullish()
			.transform((v) => v ?? []),
	}),
});

export type InboundEmailEvent = z.infer<typeof inboundEmailEventSchema>;
type InboundAttachmentMeta = z.infer<typeof inboundAttachmentSchema>;

/** Bare lower-cased address, matching the shape the allowlist stores. */
export function parseFromAddress(from: string): string {
	// The LAST angle pair, never the first: RFC 5322 puts the addr-spec at the end
	// of a mailbox, and a quoted display name may legally contain angle brackets.
	// Taking the first pair lets `"<sam@allowed.com>" <attacker@evil.com>` file an
	// attacker's mail against an allowlisted member.
	const angled = [...from.matchAll(/<([^>]*)>/g)].at(-1);
	return (angled?.[1] ?? from).trim().toLowerCase();
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
 * `get` and the image proxy — stay pinned to a key we minted rather than to a
 * filename an untrusted sender chose.
 */
export function emailBlobPathname(contentType: string): string {
	const ext = BLOB_EXTENSIONS[contentType] ?? "bin";
	return `receipts/email/${crypto.randomUUID()}.${ext}`;
}

/** One attachment's expiring download URL, from `emails.receiving.attachments.list`. */
interface AttachmentDownload {
	id: string;
	download_url: string;
	content_type?: string | null;
}

interface EmailBody {
	html: string | null;
	text: string | null;
}

interface StoredBlob {
	blobUrl: string;
	blobPathname: string;
	contentType: string;
}

interface Deps {
	db: typeof realDb;
	commitWithOutbox: <T>(
		writes: (
			tx: Parameters<Parameters<typeof realDb.transaction>[0]>[0],
		) => Promise<T>,
		events: (result: T) => OutboxEventDescriptor[],
	) => Promise<T>;
	put: (
		pathname: string,
		body: string | Uint8Array,
		options: {
			access: "private";
			contentType: string;
			addRandomSuffix: false;
		},
	) => Promise<{ url: string; pathname: string }>;
	getEmail: (emailId: string) => Promise<EmailBody>;
	listAttachments: (emailId: string) => Promise<AttachmentDownload[]>;
	fetchBytes: (url: string) => Promise<Uint8Array>;
}

export type IngestResult =
	| { status: "dropped" }
	| { status: "empty" }
	| { status: "ingested"; receiptIds: number[] };

export function makeRunIngestInboundEmail({
	db,
	commitWithOutbox,
	put,
	getEmail,
	listAttachments,
	fetchBytes,
}: Deps) {
	async function store(
		body: string | Uint8Array,
		contentType: string,
	): Promise<StoredBlob> {
		const pathname = emailBlobPathname(contentType);
		const blob = await put(pathname, body, {
			access: "private",
			contentType,
			// The uuid already makes the key unique; a suffix would rewrite the
			// pathname we are about to record on the row, breaking both read sinks.
			addRandomSuffix: false,
		});
		return {
			blobUrl: blob.url,
			blobPathname: blob.pathname,
			contentType,
		};
	}

	return async function runIngestInboundEmail(
		event: InboundEmailEvent,
	): Promise<IngestResult> {
		const from = parseFromAddress(event.data.from);
		const [sender] = await db
			.select({ userId: allowedSenders.userId })
			.from(allowedSenders)
			.where(eq(allowedSenders.email, from))
			.limit(1);

		// Design decision 8: dropped, not quarantined — and dropped here, before any
		// fetch, blob write or model call, so unknown mail costs nothing.
		if (!sender) {
			console.info("[email-ingest] dropped mail from an unknown sender", {
				from,
				emailId: event.data.email_id,
			});
			return { status: "dropped" };
		}

		const qualifying = event.data.attachments
			.filter(isReceiptAttachment)
			.slice(0, MAX_EMAIL_ATTACHMENTS);
		const stored: StoredBlob[] = [];

		if (qualifying.length) {
			// The webhook carries attachment metadata but no bytes, so the download
			// URLs are fetched here — they expire an hour after the event.
			const downloads = await listAttachments(event.data.email_id);
			const byId = new Map(downloads.map((d) => [d.id, d]));
			for (const attachment of qualifying) {
				const download = byId.get(attachment.id);
				if (!download) continue;
				const bytes = await fetchBytes(download.download_url);
				stored.push(
					await store(bytes, attachment.content_type ?? "application/pdf"),
				);
			}
		} else {
			const email = await getEmail(event.data.email_id);
			const html = email.html?.trim();
			const text = email.text?.trim();
			const body = html || text;
			// Nothing to extract from, so no row: a Receipt with an empty blob would
			// only ever reach the worker's failed state.
			if (!body) return { status: "empty" };
			stored.push(await store(body, html ? "text/html" : "text/plain"));
		}

		if (!stored.length) {
			// Resend listed attachments the metadata promised and none came back. Not
			// worth a 5xx retry storm — the mail is still in Resend if it matters.
			console.warn(
				"[email-ingest] qualifying attachments resolved to nothing",
				{
					emailId: event.data.email_id,
				},
			);
			return { status: "empty" };
		}

		// Blobs are written before the transaction, so a rolled-back commit leaves an
		// orphan blob — the same trade the receipt delete path already makes.
		const rows = await commitWithOutbox(
			async (tx) =>
				tx
					.insert(receipts)
					.values(
						stored.map((blob) => ({
							userId: sender.userId,
							status: ReceiptStatus.Pending,
							channel: ReceiptChannel.Email,
							blobUrl: blob.blobUrl,
							blobPathname: blob.blobPathname,
							contentType: blob.contentType,
						})),
					)
					.returning({ id: receipts.id }),
			(inserted) =>
				inserted.map((row) =>
					buildOutboxEvent("receipt/email.received", { receiptId: row.id }),
				),
		);

		return { status: "ingested", receiptIds: rows.map((row) => row.id) };
	};
}
