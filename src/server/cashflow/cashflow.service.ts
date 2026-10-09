import { buildCashflow, type CashflowResult } from "~/domain/cashflow";
import type { PeriodKind } from "~/lib/period";
import type { BalancesService } from "~/server/balances/balances.service";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import type { IncomeService } from "~/server/income/income.service";
import type { SettingsService } from "~/server/settings/settings.service";
import type { TransactionsService } from "~/server/transactions/transactions.service";

interface CashflowServiceDeps {
	transactions: Pick<TransactionsService, "datedAmounts" | "consumedByExpense">;
	expenses: Pick<ExpensesService, "list">;
	income: Pick<IncomeService, "list">;
	settings: Pick<SettingsService, "fortnightAnchor">;
	balances: Pick<BalancesService, "latest">;
}

// Owns no tables, so no repository: it reads through the owning services
// (adr022) and hands their rows to the pure compute in ~/domain/cashflow.
export class CashflowService {
	private readonly transactions: CashflowServiceDeps["transactions"];
	private readonly expenses: CashflowServiceDeps["expenses"];
	private readonly income: CashflowServiceDeps["income"];
	private readonly settings: CashflowServiceDeps["settings"];
	private readonly balances: CashflowServiceDeps["balances"];

	constructor({
		transactions,
		expenses,
		income,
		settings,
		balances,
	}: CashflowServiceDeps) {
		this.transactions = transactions;
		this.expenses = expenses;
		this.income = income;
		this.settings = settings;
		this.balances = balances;
	}

	// Household data stays small: load every row, window in plain code, not SQL.
	// Buckets name their period with strings, so no Date crosses the wire.
	async get(periodKind: PeriodKind): Promise<CashflowResult> {
		const [
			transactions,
			expenses,
			incomes,
			consumption,
			fortnightAnchor,
			snapshot,
		] = await Promise.all([
			this.transactions.datedAmounts(),
			this.expenses.list(),
			this.income.list(),
			this.transactions.consumedByExpense(),
			this.settings.fortnightAnchor(),
			this.balances.latest(),
		]);

		return buildCashflow({
			now: new Date(),
			periodKind,
			// UTC midnight: the grid reads UTC days, and a local midnight east of UTC
			// lands on the day before. Settings already checked the date is real.
			fortnightAnchor: fortnightAnchor
				? new Date(`${fortnightAnchor}T00:00:00.000Z`)
				: null,
			transactions,
			expenses,
			incomes,
			consumedByExpenseId: new Map(
				consumption.map(({ expenseId, consumed }) => [expenseId, consumed]),
			),
			anchor: snapshot
				? { amount: snapshot.amount, asOf: snapshot.asOf }
				: null,
		});
	}
}
