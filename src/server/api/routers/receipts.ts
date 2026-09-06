import { TRPCError } from "@trpc/server";
import { del } from "@vercel/blob";
import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";

import {
	type ReceiptDetail,
	type ReceiptListItem,
	receiptCreateDto,
} from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/auth/auth.schema";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { buildOutboxEvent } from "~/server/inngest/events";
import { commitWithOutbox } from "~/server/outbox";
import { receiptItems, receipts } from "~/server/receipts/receipts.schema";
import { transactions } from "~/server/transactions/transactions.schema";

const byId = z.object({ id: z.number() });

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

	// History table: newest first, with the uploading member and any matched
	// transaction resolved by name. The optional status filter drives the
	// processed-but-unmatched "to-do queue".
	list: protectedProcedure
		.input(z.object({ status: z.enum(ReceiptStatus).optional() }).optional())
		.query(async ({ ctx, input }): Promise<ReceiptListItem[]> => {
			return ctx.db
				.select({
					...getTableColumns(receipts),
					userName: user.name,
					transactionDescription: transactions.description,
				})
				.from(receipts)
				.leftJoin(user, eq(receipts.userId, user.id))
				.leftJoin(transactions, eq(receipts.transactionId, transactions.id))
				.where(input?.status ? eq(receipts.status, input.status) : undefined)
				.orderBy(desc(receipts.createdAt), desc(receipts.id));
		}),

	// Detail overlay: the receipt plus its line items, each with its resolved
	// expense/category label (null until Phase 5 attribution).
	get: protectedProcedure
		.input(byId)
		.query(async ({ ctx, input }): Promise<ReceiptDetail> => {
			const [receipt] = await ctx.db
				.select()
				.from(receipts)
				.where(eq(receipts.id, input.id));
			if (!receipt)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt not found.",
				});

			const items = await ctx.db
				.select({
					...getTableColumns(receiptItems),
					expenseName: expenses.name,
					expenseCategoryName: expenseCategories.name,
				})
				.from(receiptItems)
				.leftJoin(expenses, eq(receiptItems.expenseId, expenses.id))
				.leftJoin(
					expenseCategories,
					eq(receiptItems.expenseCategoryId, expenseCategories.id),
				)
				.where(eq(receiptItems.receiptId, input.id))
				.orderBy(asc(receiptItems.id));

			return { ...receipt, items };
		}),

	// Re-run a stuck extraction. The conditional update (id AND status=failed) is
	// the guard: a missing or non-failed row matches nothing and 404s before any
	// event is minted — no re-spend on an already-processed receipt.
	retry: protectedProcedure.input(byId).mutation(async ({ input }) =>
		commitWithOutbox(
			async (tx) => {
				const [row] = await tx
					.update(receipts)
					.set({ status: ReceiptStatus.Pending })
					.where(
						and(
							eq(receipts.id, input.id),
							eq(receipts.status, ReceiptStatus.Failed),
						),
					)
					.returning();
				if (!row)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Receipt not found or not in a failed state.",
					});
				return row;
			},
			(row) => [buildOutboxEvent("receipt/retry", { receiptId: row.id })],
		),
	),

	// Destructive delete for a blurry/junk receipt. The row goes first (cascade
	// removes its items; the freed transaction slot lets another receipt match);
	// the blob is best-effort after — a leftover blob is harmless, a dangling row
	// is not, so cleanup never fails the mutation.
	delete: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
		const [row] = await ctx.db
			.select({ blobPathname: receipts.blobPathname })
			.from(receipts)
			.where(eq(receipts.id, input.id));
		if (!row)
			throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found." });

		await ctx.db.delete(receipts).where(eq(receipts.id, input.id));

		try {
			await del(row.blobPathname);
		} catch {
			// Leftover blob is harmless; the row (the thing that matters) is gone.
		}
		return { success: true };
	}),
});
