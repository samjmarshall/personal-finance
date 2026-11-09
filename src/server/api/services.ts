import { allowedSendersService } from "~/server/allowed-senders/allowed-senders.module";
import { balancesService } from "~/server/balances/balances.module";
import { CashflowService } from "~/server/cashflow/cashflow.service";
import { categoriesService } from "~/server/categories/categories.module";
import { DrizzleCdrRepository } from "~/server/cdr/cdr.repository";
import { CdrService } from "~/server/cdr/cdr.service";
import { db } from "~/server/db";
import { expensesService } from "~/server/expenses/expenses.module";
import { DrizzleIncomeRepository } from "~/server/income/income.repository";
import { IncomeService } from "~/server/income/income.service";
import { outboxService } from "~/server/outbox/outbox.module";
import { receiptsService } from "~/server/receipts/receipts.module";
import { DrizzleSettingsRepository } from "~/server/settings/settings.repository";
import { SettingsService } from "~/server/settings/settings.service";
import { duplicateApplyService } from "~/server/transactions/duplicate-apply.module";
import { transactionsService } from "~/server/transactions/transactions.module";

const income = new IncomeService({
	repository: new DrizzleIncomeRepository({ db }),
});

const settings = new SettingsService({
	repository: new DrizzleSettingsRepository({ db }),
});

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	allowedSenders: allowedSendersService,
	balances: balancesService,
	cashflow: new CashflowService({
		transactions: transactionsService,
		expenses: expensesService,
		income,
		settings,
		balances: balancesService,
	}),
	categories: categoriesService,
	cdr: new CdrService({
		repository: new DrizzleCdrRepository({ db, outbox: outboxService }),
	}),
	duplicateApply: duplicateApplyService,
	expenses: expensesService,
	income,
	receipts: receiptsService,
	settings,
	transactions: transactionsService,
};

export type Services = typeof services;
