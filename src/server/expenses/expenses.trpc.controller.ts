import { z } from "zod";
import { expenseCreateDto, expenseUpdateDto } from "~/domain/expenses";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const expenseRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) => ctx.services.expenses.list()),

	// Consumed is a sum over Transactions, so the transactions service owns it (adr022).
	consumption: protectedProcedure.query(({ ctx }) =>
		ctx.services.transactions.consumedByExpense(),
	),

	// Feeds the Categories page's counts; the expenses service owns them (adr024).
	countsByCategory: protectedProcedure.query(({ ctx }) =>
		ctx.services.expenses.countsByCategory(),
	),

	create: protectedProcedure
		.input(expenseCreateDto)
		.mutation(({ ctx, input }) => ctx.services.expenses.create(input)),

	update: protectedProcedure
		.input(expenseUpdateDto)
		.mutation(({ ctx, input }) => ctx.services.expenses.update(input)),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.services.expenses.delete(input.id);
			return { success: true };
		}),
});
