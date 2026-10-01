import { z } from "zod";
import {
	linkExpenseDto,
	transactionCreateDto,
	transactionListQueryDto,
	transactionUpdateDto,
	unplannedDto,
} from "~/domain/transactions";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const transactionRouter = createTRPCRouter({
	list: protectedProcedure
		.input(transactionListQueryDto)
		.query(({ ctx, input }) => ctx.services.transactions.list(input)),

	summary: protectedProcedure.query(({ ctx }) =>
		ctx.services.transactions.summary(),
	),

	create: protectedProcedure
		.input(transactionCreateDto)
		.mutation(({ ctx, input }) => ctx.services.transactions.create(input)),

	update: protectedProcedure
		.input(transactionUpdateDto)
		.mutation(({ ctx, input }) => ctx.services.transactions.update(input)),

	unplanned: protectedProcedure
		.input(unplannedDto)
		.query(({ ctx, input }) => ctx.services.transactions.unplanned(input)),

	linkExpense: protectedProcedure
		.input(linkExpenseDto)
		.mutation(({ ctx, input }) => ctx.services.transactions.linkExpense(input)),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.services.transactions.delete(input.id);
			return { success: true };
		}),
});
