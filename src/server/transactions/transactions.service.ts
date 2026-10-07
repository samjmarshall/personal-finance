import type {
	ExpenseConsumption,
	LinkExpenseInput,
	Transaction,
	TransactionCreateInput,
	TransactionListQuery,
	TransactionListResult,
	TransactionSummary,
	TransactionUpdateInput,
	UnplannedWindow,
} from "~/domain/transactions";
import type { CategoriesService } from "~/server/categories/categories.service";
import { assertRow } from "~/server/errors/assert-row";
import { NotFoundError } from "~/server/errors/domain-errors";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import type { TransactionsRepository } from "./transactions.repository";

// Either FK on the create/update DTO (expenseId, categoryId) can raise 23503.
const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";
// linkExpense writes only expenseId, so a 23503 here can only be the expense FK —
// the message names just the expense, not the category.
const LINK_EXPENSE_CONFLICT_MESSAGE = "The selected expense no longer exists.";
const NOT_FOUND_MESSAGE = "Transaction not found.";

const distinctLinks = (ids: (number | null)[]) => [
	...new Set(ids.filter((id) => id !== null)),
];

const nameOf = (names: ReadonlyMap<number, string>, id: number | null) =>
	id === null ? null : (names.get(id) ?? null);

interface TransactionsServiceDeps {
	repository: TransactionsRepository;
	expenses: Pick<ExpensesService, "namesByIds">;
	categories: Pick<CategoriesService, "namesByIds">;
}

export class TransactionsService {
	private readonly repository: TransactionsRepository;
	private readonly expenses: Pick<ExpensesService, "namesByIds">;
	private readonly categories: Pick<CategoriesService, "namesByIds">;

	constructor({ repository, expenses, categories }: TransactionsServiceDeps) {
		this.repository = repository;
		this.expenses = expenses;
		this.categories = categories;
	}

	async list(query: TransactionListQuery): Promise<TransactionListResult> {
		const { items, total } = await this.repository.list(query);
		const [expenseNames, categoryNames] = await Promise.all([
			this.expenses.namesByIds(
				distinctLinks(items.map((row) => row.expenseId)),
			),
			this.categories.namesByIds(
				distinctLinks(items.map((row) => row.categoryId)),
			),
		]);
		return {
			items: items.map((row) => ({
				...row,
				expenseName: nameOf(expenseNames, row.expenseId),
				categoryName: nameOf(categoryNames, row.categoryId),
			})),
			total,
		};
	}

	summary(): Promise<TransactionSummary> {
		return this.repository.summary();
	}

	async create(input: TransactionCreateInput): Promise<Transaction> {
		const row = await this.repository
			.insert(input)
			.catch((error: unknown) => rethrowFkConflict(error, FK_CONFLICT_MESSAGE));
		return assertRow(row, "create transaction");
	}

	// Update-or-404 in one statement: a missing id matches no row. A pre-SELECT
	// would add a round-trip and still race a concurrent delete into a 500.
	async update({
		id,
		...values
	}: TransactionUpdateInput): Promise<Transaction> {
		const row = await this.repository
			.update(id, values)
			.catch((error: unknown) => rethrowFkConflict(error, FK_CONFLICT_MESSAGE));
		if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return row;
	}

	unplanned(window: UnplannedWindow): Promise<Transaction[]> {
		return this.repository.findUnplanned(window);
	}

	// Same update-or-404 as `update`.
	async linkExpense({ id, expenseId }: LinkExpenseInput): Promise<Transaction> {
		const row = await this.repository
			.setExpense(id, expenseId)
			.catch((error: unknown) =>
				rethrowFkConflict(error, LINK_EXPENSE_CONFLICT_MESSAGE),
			);
		if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return row;
	}

	delete(id: number): Promise<void> {
		return this.repository.delete(id);
	}

	consumedByExpense(): Promise<ExpenseConsumption[]> {
		return this.repository.consumedByExpense();
	}

	datedAmounts(): Promise<Pick<Transaction, "date" | "amount">[]> {
		return this.repository.datedAmounts();
	}
}
