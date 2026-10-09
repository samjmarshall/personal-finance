import { z } from "zod";
import {
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
} from "~/domain/receipts";
import { ReceiptStatus } from "~/lib/constants";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const byId = z.object({ id: z.number().int() });

export const receiptRouter = createTRPCRouter({
	create: protectedProcedure
		.input(receiptCreateDto)
		.mutation(({ ctx, input }) =>
			ctx.services.receipts.create(ctx.session.user.id, input),
		),

	list: protectedProcedure
		.input(
			z
				.object({
					status: z.enum(ReceiptStatus).optional(),
					unmatchedOnly: z.boolean().optional(),
				})
				.optional(),
		)
		.query(({ ctx, input }) => ctx.services.receipts.list(input ?? {})),

	get: protectedProcedure
		.input(byId)
		.query(({ ctx, input }) => ctx.services.receipts.get(input.id)),

	retry: protectedProcedure
		.input(byId)
		.mutation(({ ctx, input }) => ctx.services.receipts.retry(input.id)),

	delete: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
		await ctx.services.receipts.delete(input.id);
		return { success: true };
	}),

	matchCandidates: protectedProcedure
		.input(receiptMatchDto)
		.query(({ ctx, input }) =>
			ctx.services.receipts.matchCandidates(input.receiptId, input.timeZone),
		),

	confirmMatch: protectedProcedure
		.input(receiptConfirmMatchDto)
		.mutation(({ ctx, input }) =>
			ctx.services.receipts.confirmMatch(input.receiptId, input.transactionId),
		),

	setItemExpense: protectedProcedure
		.input(receiptItemExpenseDto)
		.mutation(({ ctx, input }) =>
			ctx.services.receipts.setItemExpense(input.itemId, input.expenseId),
		),

	setItemCategory: protectedProcedure
		.input(receiptItemCategoryDto)
		.mutation(({ ctx, input }) =>
			ctx.services.receipts.setItemCategory(input.itemId, input.categoryId),
		),
});
