import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { receipts } from "~/server/receipts/receipts.schema";

// Streams a private receipt blob to a signed-in member. The store is private, so
// the browser can't load the blob URL directly (an anonymous GET 400s) — this
// route gates on the session, then signs the read with BLOB_READ_WRITE_TOKEN via
// the SDK's `get` and pipes the bytes through under the original content type.
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
		.select({ blobUrl: receipts.blobUrl })
		.from(receipts)
		.where(eq(receipts.id, receiptId));
	if (!receipt) return new NextResponse("Not found", { status: 404 });

	const result = await get(receipt.blobUrl, { access: "private" });
	if (result?.statusCode !== 200)
		return new NextResponse("Not found", { status: 404 });

	return new NextResponse(result.stream, {
		headers: {
			"Content-Type": result.blob.contentType,
			// Sensitive image: keep it out of shared/proxy caches.
			"Cache-Control": "private, no-store",
		},
	});
}
