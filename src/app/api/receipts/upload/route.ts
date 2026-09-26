import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { RECEIPT_FILE_TYPES } from "~/domain/receipts";
import { auth } from "~/server/auth";
import { BaggageKey } from "~/server/observability/baggage";
import { traceIdHeaders } from "~/server/observability/current-trace-id";
import { withFlush } from "~/server/observability/flush";
import { createRootLogger } from "~/server/observability/logger";
import { failSpan, withSpan } from "~/server/observability/tracer";

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
	// JSON `null` / a non-object parses fine but has no `type`; reading it below
	// would throw a 500. Reject it as a bad body, same as unparseable input.
	if (typeof body !== "object" || body === null || !("type" in body)) {
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
		SPAN_NAME_BY_EVENT[body.type] ?? "blob.event",
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
				const message =
					error instanceof Error ? error.message : "Upload failed";
				const status = error instanceof UnauthorizedError ? 401 : 400;
				// Stamp every refusal, like trpc.error_code: a 401 leaves the span
				// status clean, so without this it looks like a success in PostHog.
				span.setAttribute("http.response.status_code", status);
				// A signed-out tab is routine (mirrors trpc's EXPECTED_ERROR_CODES): warn
				// only, and keep the span clean so Error Tracking sees real mint failures.
				if (status === 401) {
					logger.warn("blob token mint refused", {
						"blob.event_type": body.type,
					});
				} else {
					failSpan(span, error);
					logger.error("blob event failed", {
						error,
						"blob.event_type": body.type,
					});
				}
				return NextResponse.json(
					{ error: message },
					{ status, headers: traceIdHeaders() },
				);
			}
		},
	);
}

export const POST = withFlush(handle);
