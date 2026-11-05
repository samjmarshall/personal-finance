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
import { createRootLogger } from "~/server/observability/logging/logger";
import { outboxService } from "~/server/outbox/outbox.module";
import { receiptsService } from "~/server/receipts/receipts.module";
import { DrizzleSettingsRepository } from "~/server/settings/settings.repository";
import { SettingsService } from "~/server/settings/settings.service";
import { DuplicateApplyService } from "~/server/transactions/duplicate-apply.service";
import { transactionsService } from "~/server/transactions/transactions.module";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";

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
	duplicateApply: new DuplicateApplyService({
		repository: new DrizzleTransactionsRepository({
			db,
			outbox: outboxService,
		}),
		logger: createRootLogger().with({
			domain: "transactions",
			component: "apply",
		}),
	}),
	expenses: expensesService,
	income,
	receipts: receiptsService,
	settings,
	transactions: transactionsService,
};

export type Services = typeof services;
