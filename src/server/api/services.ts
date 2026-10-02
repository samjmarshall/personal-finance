import { db } from "~/server/db";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	expenses: new ExpensesService({
		repository: new DrizzleExpensesRepository({ db }),
	}),
	transactions: new TransactionsService({
		repository: new DrizzleTransactionsRepository({ db }),
	}),
};

export type Services = typeof services;
