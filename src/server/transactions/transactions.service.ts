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
import { assertRow } from "~/server/errors/assert-row";
import { NotFoundError } from "~/server/errors/domain-errors";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import type { TransactionsRepository } from "./transactions.repository";

// Either FK on the create/update DTO (expenseId, expenseCategoryId) can raise 23503.
const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";
// linkExpense writes only expenseId, so a 23503 here can only be the expense FK —
// the message names just the expense, not the category.
const LINK_EXPENSE_CONFLICT_MESSAGE = "The selected expense no longer exists.";
const NOT_FOUND_MESSAGE = "Transaction not found.";

interface TransactionsServiceDeps {
	repository: TransactionsRepository;
}

export class TransactionsService {
	private readonly repository: TransactionsRepository;

	constructor({ repository }: TransactionsServiceDeps) {
		this.repository = repository;
	}

	list(query: TransactionListQuery): Promise<TransactionListResult> {
		return this.repository.list(query);
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
}
