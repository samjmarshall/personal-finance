import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";

// Receipts are photos or single-page PDFs; cap the upload so a minted token can't
// write an unbounded blob. Widen if real receipts exceed it.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"];

// The only server step in the client-upload flow: mint a short-lived Blob token
// scoped to the signed-in member. The receipt row is created separately by the
// receipt.create mutation — Blob's onUploadCompleted webhook can't reach localhost,
// so it must never be the producer or dev uploads would leave no row.
export async function POST(request: Request): Promise<NextResponse> {
	let body: HandleUploadBody;
	try {
		body = (await request.json()) as HandleUploadBody;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	try {
		const jsonResponse = await handleUpload({
			request,
			body,
			// Runs only for the token-generation request, not the (webhook) completion
			// callback — so the session gate lives here, not around the whole route.
			onBeforeGenerateToken: async () => {
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session?.user) throw new Error("Unauthorized");
				return {
					allowedContentTypes: ALLOWED_CONTENT_TYPES,
					maximumSizeInBytes: MAX_UPLOAD_BYTES,
					addRandomSuffix: true,
					tokenPayload: JSON.stringify({ userId: session.user.id }),
				};
			},
			onUploadCompleted: async () => {
				// Intentionally empty — see the file note: receipt.create owns the row.
			},
		});

		return NextResponse.json(jsonResponse);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Upload failed";
		return NextResponse.json(
			{ error: message },
			{ status: message === "Unauthorized" ? 401 : 400 },
		);
	}
}
