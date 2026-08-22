import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	ilike,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	type Transaction,
	type TransactionListItem,
	type TransactionSummary,
	transactionCreateDto,
	transactionListQueryDto,
	type transactionSortBy,
	transactionUpdateDto,
} from "~/domain/transactions";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { transactions } from "~/server/transactions/transactions.schema";

export const transactionRouter = createTRPCRouter({
	list: protectedProcedure
		.input(transactionListQueryDto)
		.query(
			async ({
				ctx,
				input,
			}): Promise<{ items: TransactionListItem[]; total: number }> => {
				// Filtering
				const filters: SQL[] = [];

				if (input.search) {
					const term = `%${input.search}%`;
					const clause = or(
						ilike(transactions.description, term),
						ilike(transactions.category, term),
						ilike(transactions.notes, term),
					);
					if (clause) filters.push(clause);
				}
				if (input.priority)
					filters.push(eq(transactions.priority, input.priority));
				if (input.frequency)
					filters.push(eq(transactions.frequency, input.frequency));
				if (input.category)
					filters.push(eq(transactions.category, input.category));
				if (input.from) filters.push(gte(transactions.date, input.from));
				if (input.to) filters.push(lte(transactions.date, input.to));

				const where = filters.length ? and(...filters) : undefined;

				// Sorting
				const sortableColumns: Record<
					z.infer<typeof transactionSortBy>,
					PgColumn
				> = {
					date: transactions.date,
					description: transactions.description,
					amount: transactions.amount,
					category: transactions.category,
					priority: transactions.priority,
				};
				const orderCol = sortableColumns[input.sortBy];
				const orderBy =
					input.sortDir === "asc" ? asc(orderCol) : desc(orderCol);

				// Query execution
				const [items, countResult] = await Promise.all([
					ctx.db
						.select({
							...getTableColumns(transactions),
							expenseName: expenses.name,
							expenseCategoryName: expenseCategories.name,
						})
						.from(transactions)
						.leftJoin(expenses, eq(transactions.expenseId, expenses.id))
						.leftJoin(
							expenseCategories,
							eq(transactions.expenseCategoryId, expenseCategories.id),
						)
						.where(where)
						.orderBy(orderBy, desc(transactions.id))
						.limit(input.limit)
						.offset(input.offset),
					ctx.db
						.select({ count: sql<number>`cast(count(*) as int)` })
						.from(transactions)
						.where(where),
				]);

				return {
					items,
					total: countResult[0]?.count ?? 0,
				};
			},
		),

	summary: protectedProcedure.query(
		async ({ ctx }): Promise<TransactionSummary> => {
			const [totals] = await ctx.db
				.select({
					spend: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
					refunds: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
					net: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
					count: sql<number>`cast(count(*) as int)`,
				})
				.from(transactions);

			const byPriority = await ctx.db
				.select({
					priority: transactions.priority,
					total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
					count: sql<number>`cast(count(*) as int)`,
				})
				.from(transactions)
				.groupBy(transactions.priority);

			const byFrequency = await ctx.db
				.select({
					frequency: transactions.frequency,
					total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
					count: sql<number>`cast(count(*) as int)`,
				})
				.from(transactions)
				.groupBy(transactions.frequency);

			const byMonth = await ctx.db
				.select({
					month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
					total: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
				})
				.from(transactions)
				.groupBy(sql`date_trunc('month', ${transactions.date})`)
				.orderBy(sql`date_trunc('month', ${transactions.date})`);

			const topCategories = await ctx.db
				.select({
					category: transactions.category,
					total: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
					count: sql<number>`cast(count(*) as int)`,
				})
				.from(transactions)
				.groupBy(transactions.category)
				.orderBy(
					desc(
						sql`sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end)`,
					),
				)
				.limit(8);

			return {
				totals: totals ?? { spend: 0, refunds: 0, net: 0, count: 0 },
				byPriority,
				byFrequency,
				byMonth,
				topCategories,
			};
		},
	),

	create: protectedProcedure
		.input(transactionCreateDto)
		.mutation(async ({ ctx, input }): Promise<Transaction> => {
			const [row] = await ctx.db.insert(transactions).values(input).returning();
			return assertRow(row, "create transaction");
		}),

	update: protectedProcedure
		.input(transactionUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Transaction> => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(transactions)
				.set(values)
				.where(eq(transactions.id, id))
				.returning();
			return assertRow(row, "update transaction");
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(transactions).where(eq(transactions.id, input.id));
			return { success: true };
		}),
});
