import { put as putBlob } from "@vercel/blob";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { env } from "~/env";
import { db } from "~/server/db";
import { commitWithOutbox } from "~/server/outbox";
import {
	inboundEmailEventSchema,
	makeRunIngestInboundEmail,
} from "~/server/receipts/email-ingest";

// Attachment bytes are fetched and blobbed inline, because the download URLs
// expire and the frozen `{ receiptId }` payload needs its row to exist before the
// event fires. A mail with several large PDFs can outrun the default budget.
export const maxDuration = 60;

// Matches the client-upload ceiling in `api/receipts/upload/route.ts`: a receipt
// arriving by mail is the same artefact, so it gets the same allowance.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Ten attachments each allowed to hang would eat the whole 60s budget, so one
// download gets a fraction of it.
const DOWNLOAD_TIMEOUT_MS = 10_000;

// Built on first request, not at module scope: `new Resend(undefined)` throws, and
// the build's page-data collection imports this file with no key in the env.
let wired: {
	resend: Resend;
	run: ReturnType<typeof makeRunIngestInboundEmail>;
} | null = null;

function wire(apiKey: string) {
	if (wired) return wired;
	const resend = new Resend(apiKey);
	wired = {
		resend,
		run: makeRunIngestInboundEmail({
			db,
			commitWithOutbox,
			// The SDK's PutBody has no Uint8Array arm, so the fetched bytes are
			// wrapped here rather than making the core carry a Buffer in its types.
			put: (pathname, body, options) =>
				putBlob(
					pathname,
					typeof body === "string" ? body : Buffer.from(body),
					options,
				),
			getEmail: async (emailId) => {
				const { data, error } = await resend.emails.receiving.get(emailId);
				if (error) throw new Error(`resend get email failed: ${error.message}`);
				return { html: data.html, text: data.text };
			},
			listAttachments: async (emailId) => {
				const { data, error } = await resend.emails.receiving.attachments.list({
					emailId,
				});
				if (error)
					throw new Error(`resend list attachments failed: ${error.message}`);
				return data.data;
			},
			fetchBytes: async (url) => {
				const response = await fetch(url, {
					signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
				});
				if (!response.ok)
					throw new Error(`attachment download failed: ${response.status}`);

				// Declared length first — it rejects an oversized attachment before a
				// byte is read. It is only a claim, so the buffered length is checked
				// too; together they bound what an inbound email can make us hold.
				const declared = Number(response.headers.get("content-length"));
				if (declared > MAX_ATTACHMENT_BYTES)
					throw new Error(`attachment too large: ${declared} bytes`);

				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes.byteLength > MAX_ATTACHMENT_BYTES)
					throw new Error(`attachment too large: ${bytes.byteLength} bytes`);
				return bytes;
			},
		}),
	};
	return wired;
}

/**
 * Resend inbound webhook. Public and unauthenticated by necessity — the Svix
 * signature over the raw body is the only thing separating a real delivery from
 * anyone who knows the URL, so nothing reads the payload before it verifies.
 */
export async function POST(request: Request): Promise<Response> {
	// Raw text, never `request.json()`: the signature covers the exact bytes sent,
	// and a re-serialised object is not those bytes.
	const payload = await request.text();

	// Both are optional outside production, so an unconfigured deployment would
	// otherwise verify against an empty secret. Refuse rather than define what
	// that means.
	const webhookSecret = env.RESEND_WEBHOOK_SECRET;
	const apiKey = env.RESEND_API_KEY;
	if (!webhookSecret || !apiKey) {
		console.error("[inbound] Resend credentials are not configured");
		return new NextResponse("Not configured", { status: 500 });
	}
	const { resend, run } = wire(apiKey);

	const id = request.headers.get("svix-id");
	const timestamp = request.headers.get("svix-timestamp");
	const signature = request.headers.get("svix-signature");
	if (!id || !timestamp || !signature)
		return new NextResponse("Unauthorized", { status: 401 });

	let verified: unknown;
	try {
		verified = resend.webhooks.verify({
			payload,
			headers: { id, timestamp, signature },
			webhookSecret,
		});
	} catch {
		// Deliberately unlogged and undifferentiated: a caller must not learn whether
		// the secret, the timestamp window or the digest is what rejected them.
		return new NextResponse("Unauthorized", { status: 401 });
	}

	const parsed = inboundEmailEventSchema.safeParse(verified);
	// Signed but unreadable. Retrying will not change the shape, so it is a 200.
	if (!parsed.success) return NextResponse.json({ status: "ignored" });

	// Resend delivers every subscribed event to one endpoint; the others are not
	// this route's business, and a non-200 would make Svix retry them forever.
	if (parsed.data.type !== "email.received")
		return NextResponse.json({ status: "ignored" });

	// A genuine failure below is left to throw: a 5xx is what earns a Svix retry,
	// and an expiring download URL is worth retrying.
	const result = await run(parsed.data);

	// A drop is a verdict, not a failure — 200 so it is never redelivered.
	return NextResponse.json(result);
}
