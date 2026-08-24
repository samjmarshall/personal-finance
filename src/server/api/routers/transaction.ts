import { TRPCError } from "@trpc/server";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	ilike,
	isNull,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
	linkExpenseDto,
	type Transaction,
	type TransactionListItem,
	type TransactionSummary,
	transactionCreateDto,
	transactionListQueryDto,
	type transactionSortBy,
	transactionUpdateDto,
	unplannedDto,
} from "~/domain/transactions";
import { assertRow } from "~/server/api/lib/assert-row";
import { isPgError } from "~/server/api/lib/pg-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { transactions } from "~/server/transactions/transactions.schema";

// Either FK on the create/update DTO (expenseId, expenseCategoryId) can raise 23503.
const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";
// linkExpense only writes expenseId, so it names just the expense.
const LINK_EXPENSE_CONFLICT_MESSAGE = "The selected expense no longer exists.";

// Rethrow a Postgres FK violation (23503) as a CONFLICT with the given message;
// pass anything else through untouched.
function rethrowFkConflict(error: unknown, message: string): never {
	if (isPgError(error, "23503")) {
		throw new TRPCError({ code: "CONFLICT", message });
	}
	throw error;
}

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
			const [totalsRows, byPriority, byFrequency, byMonth, topCategories] =
				await Promise.all([
					ctx.db
						.select({
							spend: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
							refunds: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
							net: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
							count: sql<number>`cast(count(*) as int)`,
						})
						.from(transactions),
					ctx.db
						.select({
							priority: transactions.priority,
							total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
							count: sql<number>`cast(count(*) as int)`,
						})
						.from(transactions)
						.groupBy(transactions.priority),
					ctx.db
						.select({
							frequency: transactions.frequency,
							total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
							count: sql<number>`cast(count(*) as int)`,
						})
						.from(transactions)
						.groupBy(transactions.frequency),
					ctx.db
						.select({
							month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
							total: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
						})
						.from(transactions)
						.groupBy(sql`date_trunc('month', ${transactions.date})`)
						.orderBy(sql`date_trunc('month', ${transactions.date})`),
					ctx.db
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
						.limit(8),
				]);
			const totals = totalsRows[0];

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
			try {
				const [row] = await ctx.db
					.insert(transactions)
					.values(input)
					.returning();
				return assertRow(row, "create transaction");
			} catch (error) {
				rethrowFkConflict(error, FK_CONFLICT_MESSAGE);
			}
		}),

	update: protectedProcedure
		.input(transactionUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Transaction> => {
			const { id, ...values } = input;

			const [existing] = await ctx.db
				.select({ id: transactions.id })
				.from(transactions)
				.where(eq(transactions.id, id));
			if (!existing)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Transaction not found.",
				});

			try {
				const [row] = await ctx.db
					.update(transactions)
					.set(values)
					.where(eq(transactions.id, id))
					.returning();
				return assertRow(row, "update transaction");
			} catch (error) {
				rethrowFkConflict(error, FK_CONFLICT_MESSAGE);
			}
		}),

	// Unplanned = unlinked Spend in the window. Returns rows of both signs (refunds
	// net against group totals client-side); no pagination (period volume is small).
	unplanned: protectedProcedure
		.input(unplannedDto)
		.query(async ({ ctx, input }): Promise<Transaction[]> => {
			return (
				ctx.db
					.select()
					.from(transactions)
					.where(
						and(
							isNull(transactions.expenseId),
							gte(transactions.date, input.from),
							lt(transactions.date, input.to),
						),
					)
					// desc(id) is a stable final tiebreaker so same-category/same-date
					// rows keep a fixed order across refetches (matches `list`).
					.orderBy(
						asc(transactions.category),
						desc(transactions.date),
						desc(transactions.id),
					)
			);
		}),

	linkExpense: protectedProcedure
		.input(linkExpenseDto)
		.mutation(async ({ ctx, input }): Promise<Transaction> => {
			const [existing] = await ctx.db
				.select({ id: transactions.id })
				.from(transactions)
				.where(eq(transactions.id, input.id));
			if (!existing)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Transaction not found.",
				});

			try {
				const [row] = await ctx.db
					.update(transactions)
					.set({ expenseId: input.expenseId })
					.where(eq(transactions.id, input.id))
					.returning();
				return assertRow(row, "link expense");
			} catch (error) {
				rethrowFkConflict(error, LINK_EXPENSE_CONFLICT_MESSAGE);
			}
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(transactions).where(eq(transactions.id, input.id));
			return { success: true };
		}),
});
