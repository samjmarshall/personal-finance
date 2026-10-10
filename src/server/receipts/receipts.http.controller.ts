import type { HandleUploadBody } from "@vercel/blob/client";
import type { SessionReader } from "~/server/auth/session-reader";
import {
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import type { Logger } from "~/server/observability/logging/logger";
import { BaggageKey } from "~/server/observability/tracing/baggage";
import { traceIdHeaders } from "~/server/observability/tracing/current-trace-id";
import { failSpan, withSpan } from "~/server/observability/tracing/tracer";
import {
	type ReceiptsService,
	UploadUnauthorizedError,
} from "./receipts.service";

// Blob POSTs two events to the upload route: the browser's token request and, in
// production, its own upload-completed webhook. Name the span for the work done,
// not the route.
const SPAN_NAME_BY_EVENT: Record<HandleUploadBody["type"], string> = {
	"blob.generate-client-token": "blob.token.mint",
	"blob.upload-completed": "blob.upload.completed",
};

// The `receipt.id` column is an int4, so anything wider would reach Postgres and
// 500 instead of missing.
const MAX_RECEIPT_ID = 2 ** 31 - 1;

// A plain positive integer only: `Number("1e3")` would read as 1000.
function parseReceiptId(raw: string): number | null {
	if (!/^[1-9]\d*$/.test(raw)) return null;
	const id = Number(raw);
	return id <= MAX_RECEIPT_ID ? id : null;
}

// Once the body is checked, Blob's completion callback can only fail its signature
// check (the caller's fault); anything else is ours — the store token, the mint.
function failureStatus(
	error: unknown,
	type: HandleUploadBody["type"],
): 401 | 400 | 500 {
	if (error instanceof UploadUnauthorizedError) return 401;
	if (error instanceof InvalidInputError) return 400;
	return type === "blob.upload-completed" ? 400 : 500;
}

// Reject every shape Blob would throw on (null, unknown event, no pathname) as a
// bad body up front, so a throw past here is ours to own as a 500.
function isUploadBody(body: unknown): body is HandleUploadBody {
	if (typeof body !== "object" || body === null) return false;
	const { type, payload } = body as { type?: unknown; payload?: unknown };
	if (typeof type !== "string" || !Object.hasOwn(SPAN_NAME_BY_EVENT, type))
		return false;
	return (
		type !== "blob.generate-client-token" ||
		typeof (payload as { pathname?: unknown } | undefined)?.pathname ===
			"string"
	);
}

// Even a rejected body runs under Next's HTTP span, so echo its id (adr020): the
// 400 in the Network tab still names a findable trace.
function badBody(): Response {
	return Response.json(
		{ error: "Invalid request body" },
		{ status: 400, headers: traceIdHeaders() },
	);
}

const notFound = () => new Response("Not found", { status: 404 });
const unauthorized = () => new Response("Unauthorized", { status: 401 });

// E-receipt HTML is untrusted sender markup (adr019).
const HTML_CSP = [
	// No script, fetch, frames or fonts.
	"default-src 'none'",
	// E-receipts carry their layout in inline styles.
	"style-src 'unsafe-inline'",
	// Remote images are tracking pixels; inline ones are harmless.
	"img-src data:",
	"base-uri 'none'",
	"form-action 'none'",
	// Overrides the app-wide `X-Frame-Options: SAMEORIGIN` (next.config.ts), which a
	// browser may judge against the sandbox's opaque origin and refuse the frame.
	"frame-ancestors 'self'",
	// A second lock beside the iframe's own `sandbox` attribute.
	"sandbox",
].join("; ");

interface ReceiptsHttpControllerDeps {
	service: ReceiptsService;
	sessions: SessionReader;
	logger: Logger;
}

/**
 * The receipt image proxy, the sandboxed e-receipt body and the Blob client-upload
 * handshake. Each gates on the session here; the rules (what may be served, what
 * may be uploaded) are the service's.
 */
export class ReceiptsHttpController {
	private readonly service: ReceiptsService;
	private readonly sessions: SessionReader;
	private readonly logger: Logger;

	constructor({ service, sessions, logger }: ReceiptsHttpControllerDeps) {
		this.service = service;
		this.sessions = sessions;
		this.logger = logger;
	}

	// Streams a private receipt blob to a signed-in member. The store is private, so
	// the browser can't load the blob URL directly (an anonymous GET 400s).
	async image(request: Request, rawId: string): Promise<Response> {
		if (!(await this.signedIn(request))) return unauthorized();

		const id = parseReceiptId(rawId);
		if (id === null) return notFound();

		try {
			const image = await this.service.openImage(id);
			return new Response(image.stream, {
				headers: {
					"Content-Type": image.contentType,
					// Belt-and-braces with the service's allowlist: stop the browser
					// MIME-sniffing an octet-stream back up into renderable HTML.
					"X-Content-Type-Options": "nosniff",
					// Sensitive image: keep it out of shared/proxy caches.
					"Cache-Control": "private, no-store",
				},
			});
		} catch (error) {
			if (error instanceof NotFoundError) return notFound();
			throw error;
		}
	}

	// The e-receipt body for the viewer's `<iframe sandbox="">` (adr019).
	async html(request: Request, rawId: string): Promise<Response> {
		if (!(await this.signedIn(request))) return unauthorized();

		const id = parseReceiptId(rawId);
		if (id === null) return notFound();

		try {
			const body = await this.service.openHtml(id);
			return new Response(body.stream, {
				headers: {
					"Content-Type": body.contentType,
					"Content-Security-Policy": HTML_CSP,
					"X-Content-Type-Options": "nosniff",
					"Cache-Control": "private, no-store",
					"Referrer-Policy": "no-referrer",
				},
			});
		} catch (error) {
			if (error instanceof NotFoundError) return notFound();
			throw error;
		}
	}

	// TODO(households): scope receipt reads to the viewer's household once households
	// exist. Today every signed-in Member may view every receipt.
	private async signedIn(request: Request): Promise<boolean> {
		return (await this.sessions.memberId(request.headers)) !== undefined;
	}

	// This request is its own trace root (adr020). Blob's `upload()` hides the token
	// response from the browser, so the id can't be chained into receipt.create; the
	// two traces sit side by side under one `posthog.distinct_id`, and the x-trace-id
	// echo names this one in the Network tab.
	async upload(request: Request): Promise<Response> {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return badBody();
		}
		if (!isUploadBody(body)) return badBody();
		const event = body;

		// Only the browser's token request has a member; Blob's completion webhook has
		// none. Resolve it before the span opens and put it on baggage, so the span,
		// its logs and any child spans all carry member.id — same as the tRPC middleware.
		const memberId =
			event.type === "blob.generate-client-token"
				? await this.sessions.memberId(request.headers)
				: undefined;
		return withSpan(
			SPAN_NAME_BY_EVENT[event.type],
			{
				attributes: { "blob.event_type": event.type },
				baggage: { [BaggageKey.MemberId]: memberId },
			},
			async (span) => {
				try {
					// `pathname` is the requested name; Blob appends the random suffix.
					if (event.type === "blob.generate-client-token" && memberId) {
						span.setAttribute("blob.pathname", event.payload.pathname);
					}
					const answer = await this.service.answerUpload(
						request,
						event,
						memberId,
					);
					return Response.json(answer, { headers: traceIdHeaders() });
				} catch (error) {
					const status = failureStatus(error, event.type);
					// Stamp every refusal, like trpc.error_code: a 401 leaves the span
					// status clean, so without this it looks like a success in PostHog.
					span.setAttribute("http.response.status_code", status);
					// Same levels as the tRPC middleware: a signed-out tab is routine (warn,
					// clean span), a rejected callback or token path is the caller's fault
					// (warn), the rest is ours (error).
					if (status === 401) {
						this.logger.warn("blob token mint refused", {
							"blob.event_type": event.type,
						});
					} else if (status === 400) {
						failSpan(span, error);
						this.logger.warn(
							event.type === "blob.upload-completed"
								? "blob callback rejected"
								: "blob token mint rejected",
							{
								error,
								"blob.event_type": event.type,
							},
						);
					} else {
						failSpan(span, error);
						this.logger.error("blob event failed", {
							error,
							"blob.event_type": event.type,
						});
					}
					// A 500's message is ours (e.g. a missing store token), not the caller's.
					const message =
						status !== 500 && error instanceof Error
							? error.message
							: "Upload failed";
					return Response.json(
						{ error: message },
						{ status, headers: traceIdHeaders() },
					);
				}
			},
		);
	}
}
