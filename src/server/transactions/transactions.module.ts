import { categoriesService } from "~/server/categories/categories.module";
import { db } from "~/server/db";
import { expensesService } from "~/server/expenses/expenses.module";
import { outboxService } from "~/server/outbox/outbox.module";

import { DrizzleTransactionsRepository } from "./transactions.repository";
import { TransactionsService } from "./transactions.service";

export const transactionsService = new TransactionsService({
	repository: new DrizzleTransactionsRepository({ db, outbox: outboxService }),
	expenses: expensesService,
	categories: categoriesService,
});
