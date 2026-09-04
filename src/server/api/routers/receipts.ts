import { receiptCreateDto } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { buildOutboxEvent } from "~/server/inngest/events";
import { commitWithOutbox } from "~/server/outbox";
import { receipts } from "~/server/receipts/receipts.schema";

export const receiptRouter = createTRPCRouter({
	// The producer for the receipt pipeline: the client has already put the file in
	// Blob and sends its coordinates; we persist a pending row (ownership + status
	// server-set) and emit receipt/uploaded so the worker extracts it. Row + event
	// commit together — the event id is the row's, known only after the insert.
	create: protectedProcedure
		.input(receiptCreateDto)
		.mutation(async ({ ctx, input }) =>
			commitWithOutbox(
				async (tx) => {
					const [row] = await tx
						.insert(receipts)
						.values({
							userId: ctx.session.user.id,
							status: ReceiptStatus.Pending,
							channel: ReceiptChannel.Upload,
							blobUrl: input.blobUrl,
							blobPathname: input.blobPathname,
							contentType: input.contentType,
						})
						.returning();
					return assertRow(row, "create receipt");
				},
				(row) => [buildOutboxEvent("receipt/uploaded", { receiptId: row.id })],
			),
		),
});
