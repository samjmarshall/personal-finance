import { allowedSenderRouter } from "~/server/api/routers/allowed-sender";
import { balanceRouter } from "~/server/api/routers/balance";
import { cashflowRouter } from "~/server/api/routers/cashflow";
import { categoryRouter } from "~/server/api/routers/category";
import { expenseRouter } from "~/server/api/routers/expense";
import { incomeRouter } from "~/server/api/routers/income";
import { receiptRouter } from "~/server/api/routers/receipts";
import { settingRouter } from "~/server/api/routers/setting";
import { transactionRouter } from "~/server/api/routers/transaction";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
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
