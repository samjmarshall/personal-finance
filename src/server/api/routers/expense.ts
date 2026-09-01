import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type Expense,
	expenseCreateDto,
	expenseUpdateDto,
} from "~/domain/expenses";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenses } from "~/server/expenses/expenses.schema";
import { transactions } from "~/server/transactions/transactions.schema";

export const expenseRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }): Promise<Expense[]> => {
		return ctx.db
			.select()
			.from(expenses)
			.orderBy(
				asc(expenses.category),
				asc(expenses.sortOrder),
				asc(expenses.name),
			);
	}),

	// Lifetime spend linked to each expense, for the Planned-page consumed/remaining
	// read-model. Reads the sibling transactions table (sanctioned cross-domain read
	// join). Sum nets refunds (negative Inflow) against Spend, per glossary signs.
	consumption: protectedProcedure.query(
		async ({ ctx }): Promise<{ expenseId: number; consumed: number }[]> => {
			const rows = await ctx.db
				.select({
					expenseId: transactions.expenseId,
					consumed:
						sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(
							Number,
						),
				})
				.from(transactions)
				.where(isNotNull(transactions.expenseId))
				.groupBy(transactions.expenseId);
			// expenseId is non-null by the isNotNull filter; drop the join-nullable type.
			return rows.map((r) => ({
				expenseId: r.expenseId as number,
				consumed: r.consumed,
			}));
		},
	),

	create: protectedProcedure
		.input(expenseCreateDto)
		.mutation(async ({ ctx, input }): Promise<Expense> => {
			const [row] = await ctx.db.insert(expenses).values(input).returning();
			return assertRow(row, "create expense");
		}),

	update: protectedProcedure
		.input(expenseUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Expense> => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(expenses)
				.set(values)
				.where(eq(expenses.id, id))
				.returning();
			return assertRow(row, "update expense");
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(expenses).where(eq(expenses.id, input.id));
			return { success: true };
		}),
});
