import { db } from "~/server/db";

import { DrizzleExpensesRepository } from "./expenses.repository";
import { ExpensesService } from "./expenses.service";

// One shared instance. Other roots import it; don't rebuild it.
export const expensesService = new ExpensesService({
	repository: new DrizzleExpensesRepository({ db }),
});
