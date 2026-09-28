import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { RECEIPT_FILE_TYPES } from "~/domain/receipts";
import { auth } from "~/server/auth";
import { createRootLogger } from "~/server/observability/logging/logger";
import { withFlush } from "~/server/observability/sdk/flush";
import { BaggageKey } from "~/server/observability/tracing/baggage";
import { traceIdHeaders } from "~/server/observability/tracing/current-trace-id";
import { failSpan, withSpan } from "~/server/observability/tracing/tracer";

const logger = createRootLogger().with({
	domain: "receipts",
	component: "upload-route",
});

// Receipts are photos or single-page PDFs; cap the upload so a minted token can't
// write an unbounded blob. Widen if real receipts exceed it.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Blob POSTs two events here: the browser's token request and, in production, its
// own upload-completed webhook. Name the span for the work done, not the route.
const SPAN_NAME_BY_EVENT: Record<HandleUploadBody["type"], string> = {
	"blob.generate-client-token": "blob.token.mint",
	"blob.upload-completed": "blob.upload.completed",
};

// Blob passes a throw from the token hook straight through, so a class survives
// to the catch where a matched message string could silently stop matching.
class UnauthorizedError extends Error {
	constructor() {
		super("Unauthorized");
	}
}

// Once the body is checked, Blob's completion callback can only fail its signature
// check (the caller's fault); anything else is ours — the store token, the mint.
function failureStatus(
	error: unknown,
	type: HandleUploadBody["type"],
): 401 | 400 | 500 {
	if (error instanceof UnauthorizedError) return 401;
	return type === "blob.upload-completed" ? 400 : 500;
}

// Even a rejected body runs under Next's HTTP span, so echo its id (adr020): the
// 400 in the Network tab still names a findable trace.
function badBody(): NextResponse {
	return NextResponse.json(
		{ error: "Invalid request body" },
		{ status: 400, headers: traceIdHeaders() },
	);
}

// The only server step in the client-upload flow: mint a short-lived Blob token
// scoped to the signed-in member. The receipt row is created separately by the
// receipt.create mutation — Blob's onUploadCompleted webhook can't reach localhost,
// so it must never be the producer or dev uploads would leave no row.
//
// This request is its own trace root (adr020). Blob's `upload()` hides the token
// response from the browser, so the id can't be chained into receipt.create; the
// two traces sit side by side under one `posthog.distinct_id`, and the x-trace-id
// echo names this one in the Network tab.
async function handle(request: Request): Promise<NextResponse> {
	let body: HandleUploadBody;
	try {
		body = (await request.json()) as HandleUploadBody;
	} catch {
		return badBody();
	}
	// Reject every shape Blob would throw on (null, unknown event, no pathname) as a
	// bad body up front, so a throw past here is ours to own as a 500.
	if (
		typeof body !== "object" ||
		body === null ||
		!Object.hasOwn(SPAN_NAME_BY_EVENT, body.type) ||
		(body.type === "blob.generate-client-token" &&
			typeof (body.payload as { pathname?: unknown } | undefined)?.pathname !==
				"string")
	) {
		return badBody();
	}

	// Only the browser's token request has a member; Blob's completion webhook has
	// none. Resolve it before the span opens and put it on baggage, so the span,
	// its logs and any child spans all carry member.id — same as the tRPC middleware.
	const session =
		body.type === "blob.generate-client-token"
			? await auth.api.getSession({ headers: request.headers })
			: null;
	return withSpan(
		SPAN_NAME_BY_EVENT[body.type],
		{
			attributes: { "blob.event_type": body.type },
			baggage: { [BaggageKey.MemberId]: session?.user?.id },
		},
		async (span) => {
			try {
				const jsonResponse = await handleUpload({
					request,
					body,
					// Runs only for the token-generation request, not the (webhook) completion
					// callback — so the session gate lives here, not around the whole route.
					onBeforeGenerateToken: async (pathname) => {
						if (!session?.user) throw new UnauthorizedError();
						// `pathname` is the requested name; Blob appends the random suffix.
						span.setAttribute("blob.pathname", pathname);
						return {
							allowedContentTypes: [...RECEIPT_FILE_TYPES],
							maximumSizeInBytes: MAX_UPLOAD_BYTES,
							addRandomSuffix: true,
							tokenPayload: JSON.stringify({ userId: session.user.id }),
						};
					},
					onUploadCompleted: async () => {
						// Intentionally empty — see the file note: receipt.create owns the row.
					},
				});

				return NextResponse.json(jsonResponse, { headers: traceIdHeaders() });
			} catch (error) {
				const status = failureStatus(error, body.type);
				// Stamp every refusal, like trpc.error_code: a 401 leaves the span
				// status clean, so without this it looks like a success in PostHog.
				span.setAttribute("http.response.status_code", status);
				// Same levels as the tRPC middleware: a signed-out tab is routine (warn,
				// clean span), a rejected callback is the caller's fault (warn), the rest
				// is ours (error).
				if (status === 401) {
					logger.warn("blob token mint refused", {
						"blob.event_type": body.type,
					});
				} else if (status === 400) {
					failSpan(span, error);
					logger.warn("blob callback rejected", {
						error,
						"blob.event_type": body.type,
					});
				} else {
					failSpan(span, error);
					logger.error("blob event failed", {
						error,
						"blob.event_type": body.type,
					});
				}
				// A 500's message is ours (e.g. a missing store token), not the caller's.
				const message =
					status !== 500 && error instanceof Error
						? error.message
						: "Upload failed";
				return NextResponse.json(
					{ error: message },
					{ status, headers: traceIdHeaders() },
				);
			}
		},
	);
}

export const POST = withFlush(handle);
