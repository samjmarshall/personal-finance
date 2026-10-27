import type { Resend } from "resend";

/** One attachment's expiring download URL, from `emails.receiving.attachments.list`. */
export interface AttachmentDownload {
	id: string;
	download_url: string;
	content_type?: string | null;
}

export interface EmailBody {
	html: string | null;
	text: string | null;
}

/**
 * Read side of the inbound mailbox. The webhook carries attachment metadata but no
 * bytes and no body; everything below is fetched after the event lands.
 */
export interface InboundMailbox {
	getBody(emailId: string): Promise<EmailBody>;
	/** Download URLs expire about an hour after the event. */
	listAttachments(emailId: string): Promise<AttachmentDownload[]>;
	/** Throws on a non-2xx, a timeout, or a body over MAX_ATTACHMENT_BYTES. */
	download(url: string): Promise<Uint8Array>;
}

// Matches the client-upload ceiling (`MAX_UPLOAD_BYTES` in `receipts.service.ts`): a receipt
// arriving by mail is the same artefact, so it gets the same allowance.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Ten attachments each allowed to hang would eat the route's whole 60s budget, so
// one download gets a fraction of it.
const DOWNLOAD_TIMEOUT_MS = 10_000;
// The Resend API reads get the same cap, so a slow API can't eat the budget either.
const RESEND_READ_TIMEOUT_MS = 10_000;

interface ResendInboundMailboxDeps {
	resend: Pick<Resend, "emails">;
}

export class ResendInboundMailbox implements InboundMailbox {
	private readonly resend: Pick<Resend, "emails">;

	constructor({ resend }: ResendInboundMailboxDeps) {
		this.resend = resend;
	}

	async getBody(emailId: string): Promise<EmailBody> {
		const { data, error } = await this.resend.emails.receiving.get(
			emailId,
			undefined,
			{ signal: AbortSignal.timeout(RESEND_READ_TIMEOUT_MS) },
		);
		if (error) throw new Error(`resend get email failed: ${error.message}`);
		return { html: data.html, text: data.text };
	}

	async listAttachments(emailId: string): Promise<AttachmentDownload[]> {
		const { data, error } = await this.resend.emails.receiving.attachments.list(
			{ emailId },
			{ signal: AbortSignal.timeout(RESEND_READ_TIMEOUT_MS) },
		);
		if (error)
			throw new Error(`resend list attachments failed: ${error.message}`);
		return data.data;
	}

	async download(url: string): Promise<Uint8Array> {
		// The query string is the signature — anyone holding it can download the
		// attachment — so the traced span gets the URL without it.
		const unsigned = url.split("?")[0];
		const response = await fetch(url, {
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
			opentelemetry: {
				spanName: `fetch GET ${unsigned}`,
				attributes: { "http.url": unsigned },
			},
		});
		if (!response.ok)
			throw new Error(`attachment download failed: ${response.status}`);

		// Declared length first — it rejects an oversized attachment before a byte is
		// read. It is only a claim, so the buffered length is checked too; together
		// they bound what an inbound email can make us hold.
		const declared = Number(response.headers.get("content-length"));
		if (declared > MAX_ATTACHMENT_BYTES)
			throw new Error(`attachment too large: ${declared} bytes`);

		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > MAX_ATTACHMENT_BYTES)
			throw new Error(`attachment too large: ${bytes.byteLength} bytes`);
		return bytes;
	}
}
