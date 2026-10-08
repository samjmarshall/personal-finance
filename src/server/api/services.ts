import { membersService } from "~/server/auth/members.module";
import { DrizzleBalancesRepository } from "~/server/balances/balances.repository";
import { BalancesService } from "~/server/balances/balances.service";
import { CashflowService } from "~/server/cashflow/cashflow.service";
import { categoriesService } from "~/server/categories/categories.module";
import { db } from "~/server/db";
import { DrizzleAllowedSenderRepository } from "~/server/email/allowed-sender.repository";
import { AllowedSenderService } from "~/server/email/allowed-sender.service";
import { expensesService } from "~/server/expenses/expenses.module";
import { DrizzleIncomeRepository } from "~/server/income/income.repository";
import { IncomeService } from "~/server/income/income.service";
import { DrizzleSettingsRepository } from "~/server/settings/settings.repository";
import { SettingsService } from "~/server/settings/settings.service";
import { transactionsService } from "~/server/transactions/transactions.module";

const balances = new BalancesService({
	repository: new DrizzleBalancesRepository({ db }),
});

const income = new IncomeService({
	repository: new DrizzleIncomeRepository({ db }),
});

const settings = new SettingsService({
	repository: new DrizzleSettingsRepository({ db }),
});

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	allowedSenders: new AllowedSenderService({
		repository: new DrizzleAllowedSenderRepository({ db }),
		members: membersService,
	}),
	balances,
	cashflow: new CashflowService({
		transactions: transactionsService,
		expenses: expensesService,
		income,
		settings,
		balances,
	}),
	categories: categoriesService,
	expenses: expensesService,
	income,
	settings,
	transactions: transactionsService,
};

export type Services = typeof services;
