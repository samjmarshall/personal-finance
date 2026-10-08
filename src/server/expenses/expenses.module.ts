import { db } from "~/server/db";

import { DrizzleExpensesRepository } from "./expenses.repository";
import { ExpensesService } from "./expenses.service";

// Shared by the tRPC root and transactions.module.ts.
export const expensesService = new ExpensesService({
	repository: new DrizzleExpensesRepository({ db }),
});
