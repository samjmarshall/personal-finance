import { allowedSenderRouter } from "~/server/allowed-senders/allowed-senders.trpc.controller";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { balanceRouter } from "~/server/balances/balances.trpc.controller";
import { cashflowRouter } from "~/server/cashflow/cashflow.trpc.controller";
import { categoryRouter } from "~/server/categories/categories.trpc.controller";
import { expenseRouter } from "~/server/expenses/expenses.trpc.controller";
import { incomeRouter } from "~/server/income/income.trpc.controller";
import { receiptRouter } from "~/server/receipts/receipts.trpc.controller";
import { settingRouter } from "~/server/settings/settings.trpc.controller";
import { transactionRouter } from "~/server/transactions/transactions.trpc.controller";

/** Every tRPC controller, keyed by client path (`api.<key>.*`); renaming a key breaks callers. */
export const appRouter = createTRPCRouter({
	allowedSender: allowedSenderRouter,
	balance: balanceRouter,
	cashflow: cashflowRouter,
	category: categoryRouter,
	expense: expenseRouter,
	income: incomeRouter,
	receipt: receiptRouter,
	setting: settingRouter,
	transaction: transactionRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.expense.list();
 *       ^? Expense[]
 */
export const createCaller = createCallerFactory(appRouter);
