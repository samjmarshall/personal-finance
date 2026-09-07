import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { receipts } from "~/server/receipts/receipts.schema";

// Only ever hand the browser a type it renders inertly. Blob metadata is set at
// upload time by the member, so a `text/html` value would otherwise stream back
// same-origin as executable markup — anything off this list downgrades to a
// non-sniffable octet-stream (paired with X-Content-Type-Options below).
const RENDERABLE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
]);

// Streams a private receipt blob to a signed-in member. The store is private, so
// the browser can't load the blob URL directly (an anonymous GET 400s) — this
// route gates on the session, then signs the read with BLOB_READ_WRITE_TOKEN via
// the SDK's `get` and pipes the bytes through under the original content type.
//
// Reads by `blobPathname`, never the member-supplied `blobUrl`: the SDK resolves
// a pathname against *our* store token, so a URL pointing at a foreign public
// store can't be streamed back same-origin as `text/html`.
export async function GET(
	request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

	const receiptId = Number((await ctx.params).id);
	if (!Number.isInteger(receiptId))
		return new NextResponse("Not found", { status: 404 });

	const [receipt] = await db
		.select({ blobPathname: receipts.blobPathname })
		.from(receipts)
		.where(eq(receipts.id, receiptId));
	if (!receipt) return new NextResponse("Not found", { status: 404 });

	const result = await get(receipt.blobPathname, { access: "private" });
	if (result?.statusCode !== 200)
		return new NextResponse("Not found", { status: 404 });

	const contentType = RENDERABLE_TYPES.has(result.blob.contentType)
		? result.blob.contentType
		: "application/octet-stream";

	return new NextResponse(result.stream, {
		headers: {
			"Content-Type": contentType,
			// Belt-and-braces with the allowlist: stop the browser MIME-sniffing an
			// octet-stream back up into renderable HTML.
			"X-Content-Type-Options": "nosniff",
			// Sensitive image: keep it out of shared/proxy caches.
			"Cache-Control": "private, no-store",
		},
	});
}
