import { db } from "~/server/db";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleIncomeRepository } from "~/server/income/income.repository";
import { IncomeService } from "~/server/income/income.service";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";

const expenses = new ExpensesService({
	repository: new DrizzleExpensesRepository({ db }),
});

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	expenses,
	income: new IncomeService({
		repository: new DrizzleIncomeRepository({ db }),
	}),
	transactions: new TransactionsService({
		repository: new DrizzleTransactionsRepository({ db }),
		expenses,
	}),
};

export type Services = typeof services;
