import { desc, eq, isNotNull, sql } from "drizzle-orm";
import {
	buildCashflow,
	type CashflowResult,
	cashflowQueryDto,
} from "~/domain/cashflow";
import { fromDateInput } from "~/lib/utils";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { balanceSnapshots } from "~/server/balances/balances.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { income } from "~/server/income/income.schema";
import { FORTNIGHT_ANCHOR_KEY } from "~/server/settings/settings.constants";
import { appSettings } from "~/server/settings/settings.schema";
import { transactions } from "~/server/transactions/transactions.schema";

export const cashflowRouter = createTRPCRouter({
	// Loads every row (volume stays small for a household) and windows in the pure TS
	// core — no SQL windowing. Buckets carry string key/label — no Date crosses the wire.
	get: protectedProcedure
		.input(cashflowQueryDto)
		.query(async ({ ctx, input }): Promise<CashflowResult> => {
			const [
				txRows,
				expenseRows,
				incomeRows,
				consumptionRows,
				anchorRows,
				snapshotRows,
			] = await Promise.all([
				ctx.db
					.select({ date: transactions.date, amount: transactions.amount })
					.from(transactions),
				ctx.db.select().from(expenses),
				ctx.db.select().from(income),
				// Lifetime spend per expense, netting refunds — same select as
				// expense.consumption; two small uses don't warrant a shared helper.
				ctx.db
					.select({
						expenseId: transactions.expenseId,
						consumed:
							sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(
								Number,
							),
					})
					.from(transactions)
					.where(isNotNull(transactions.expenseId))
					.groupBy(transactions.expenseId),
				ctx.db
					.select({ value: appSettings.value })
					.from(appSettings)
					.where(eq(appSettings.key, FORTNIGHT_ANCHOR_KEY)),
				ctx.db
					.select()
					.from(balanceSnapshots)
					.orderBy(desc(balanceSnapshots.asOf), desc(balanceSnapshots.id))
					.limit(1),
			]);

			const consumedByExpenseId = new Map(
				consumptionRows.map((r) => [r.expenseId as number, r.consumed]),
			);
			const anchorValue = anchorRows[0]?.value;
			const snapshot = snapshotRows[0];

			return buildCashflow({
				now: new Date(),
				periodKind: input.periodKind,
				fortnightAnchor: anchorValue ? fromDateInput(anchorValue) : null,
				transactions: txRows,
				expenses: expenseRows,
				incomes: incomeRows,
				consumedByExpenseId,
				anchor: snapshot
					? { amount: snapshot.amount, asOf: snapshot.asOf }
					: null,
			});
		}),
});
