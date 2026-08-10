import { expenseRouter } from "~/server/api/routers/expense";
import { incomeRouter } from "~/server/api/routers/income";
import { transactionRouter } from "~/server/api/routers/transaction";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	expense: expenseRouter,
	income: incomeRouter,
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
