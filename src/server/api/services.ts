import { db } from "~/server/db";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";

const expenses = new ExpensesService({
	repository: new DrizzleExpensesRepository({ db }),
});

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	expenses,
	transactions: new TransactionsService({
		repository: new DrizzleTransactionsRepository({ db }),
		expenses,
	}),
};

export type Services = typeof services;
