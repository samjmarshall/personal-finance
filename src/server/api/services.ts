import { DrizzleMembersRepository } from "~/server/auth/members.repository";
import { MembersService } from "~/server/auth/members.service";
import { DrizzleBalancesRepository } from "~/server/balances/balances.repository";
import { BalancesService } from "~/server/balances/balances.service";
import { db } from "~/server/db";
import { DrizzleAllowedSenderRepository } from "~/server/email/allowed-sender.repository";
import { AllowedSenderService } from "~/server/email/allowed-sender.service";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleIncomeRepository } from "~/server/income/income.repository";
import { IncomeService } from "~/server/income/income.service";
import { DrizzleSettingsRepository } from "~/server/settings/settings.repository";
import { SettingsService } from "~/server/settings/settings.service";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";

const expenses = new ExpensesService({
	repository: new DrizzleExpensesRepository({ db }),
});

// Off `services`: no controller calls it, only other services.
const members = new MembersService({
	repository: new DrizzleMembersRepository({ db }),
});

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	allowedSenders: new AllowedSenderService({
		repository: new DrizzleAllowedSenderRepository({ db }),
		members,
	}),
	balances: new BalancesService({
		repository: new DrizzleBalancesRepository({ db }),
	}),
	expenses,
	income: new IncomeService({
		repository: new DrizzleIncomeRepository({ db }),
	}),
	settings: new SettingsService({
		repository: new DrizzleSettingsRepository({ db }),
	}),
	transactions: new TransactionsService({
		repository: new DrizzleTransactionsRepository({ db }),
		expenses,
	}),
};

export type Services = typeof services;
