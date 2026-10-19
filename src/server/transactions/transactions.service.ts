import type {
	ExpenseConsumption,
	LinkExpenseInput,
	SyncedTransaction,
	Transaction,
	TransactionCreateInput,
	TransactionListQuery,
	TransactionListResult,
	TransactionSummary,
	TransactionUpdateInput,
	UnplannedWindow,
} from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import type { CategoriesService } from "~/server/categories/categories.service";
import { assertRow } from "~/server/errors/assert-row";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import type {
	DatedTransaction,
	DateWindow,
	TransactionLink,
	TransactionsRepository,
} from "./transactions.repository";

// A save can fail because the Expense or Category was deleted.
const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";
// Unlink also writes a Category, but one just read from a live row. So only
// the Expense can be gone.
const LINK_EXPENSE_CONFLICT_MESSAGE = "The selected expense no longer exists.";
// The database refuses a Category on a Transaction that has an Expense.
const LINKED_CATEGORY_MESSAGE =
	"A Transaction linked to an Expense takes its Category from the Expense.";
const NOT_FOUND_MESSAGE = "Transaction not found.";
// Each re-sync rewrites a synced row's amount and date, so an edit would vanish.
const BANK_OWNED_MESSAGE = "Amount and date come from the bank.";

const rethrowWriteConflict = (error: unknown, fkMessage: string): never => {
	if (isPgViolation(error, PgViolation.CheckViolation)) {
		throw new ConflictError(LINKED_CATEGORY_MESSAGE, { cause: error });
	}
	return rethrowFkConflict(error, fkMessage);
};

const distinctLinks = (ids: (number | null)[]) => [
	...new Set(ids.filter((id) => id !== null)),
];

const entryOf = <T>(entries: ReadonlyMap<number, T>, id: number | null) =>
	id === null ? undefined : entries.get(id);

// Transactions → Expenses and Categories are downward calls (adr022, adr025).
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

	// One after the other: a linked row's Category comes from its Expense
	// (adr025), so the Category ids are known only once Expenses answer.
	async list(query: TransactionListQuery): Promise<TransactionListResult> {
		const { items, total } = await this.repository.list(query);
		const expenses = await this.expenses.namesByIds(
			distinctLinks(items.map((row) => row.expenseId)),
		);
		const effectiveCategoryId = (row: Transaction) =>
			row.expenseId === null
				? row.categoryId
				: (entryOf(expenses, row.expenseId)?.categoryId ?? null);
		const categoryNames = await this.categories.namesByIds(
			distinctLinks(items.map(effectiveCategoryId)),
		);
		return {
			items: items.map((row) => ({
				...row,
				expenseName: entryOf(expenses, row.expenseId)?.name ?? null,
				categoryName: entryOf(categoryNames, effectiveCategoryId(row)) ?? null,
			})),
			total,
		};
	}

	summary(): Promise<TransactionSummary> {
		return this.repository.summary();
	}

	async create(input: TransactionCreateInput): Promise<Transaction> {
		const row = await this.repository
			.insert({ ...input, ...(await this.categoryPatch(input)) })
			.catch((error: unknown) =>
				rethrowWriteConflict(error, FK_CONFLICT_MESSAGE),
			);
		return assertRow(row, "create transaction");
	}

	// A page that shifts mid-fetch can repeat a row, and Postgres refuses one
	// upsert that hits the same row twice (SQLSTATE 21000). The later copy wins.
	upsertSynced(rows: SyncedTransaction[]): Promise<void> {
		const unique = new Map(
			rows.map((row) => [`${row.provenance}:${row.externalId}`, row]),
		);
		return this.repository.upsertSynced([...unique.values()]);
	}

	// A missing id 404s at the first read; a row deleted between that read and
	// the write still 404s.
	async update({
		id,
		...values
	}: TransactionUpdateInput): Promise<Transaction> {
		const synced = await this.guardBankValues(id, values);
		// Left out on a synced row, so a sync landing mid-edit isn't written over.
		const { amount, date, ...rest } = values;
		const patch = synced ? rest : values;
		const row = await this.repository
			.update(id, { ...patch, ...(await this.categoryPatch(values, id)) })
			.catch((error: unknown) =>
				rethrowWriteConflict(error, FK_CONFLICT_MESSAGE),
			);
		if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return row;
	}

	unplanned(window: UnplannedWindow): Promise<Transaction[]> {
		return this.repository.findUnplanned(window);
	}

	inDateWindow(window: DateWindow): Promise<DatedTransaction[]> {
		return this.repository.findInDateWindow(window);
	}

	// The batched lookup that replaces a cross-domain join (adr022): one call per
	// request, never per row. An id with no row has no entry.
	async descriptionsByIds(ids: number[]): Promise<ReadonlyMap<number, string>> {
		const rows = ids.length ? await this.repository.findDescriptions(ids) : [];
		return new Map(rows.map(({ id, description }) => [id, description]));
	}

	async linkExpense({ id, expenseId }: LinkExpenseInput): Promise<Transaction> {
		const categoryId =
			expenseId === null ? await this.categoryBeforeUnlink(id) : null;
		const row = await this.repository
			.setLink(id, { expenseId, categoryId })
			.catch((error: unknown) =>
				rethrowWriteConflict(error, LINK_EXPENSE_CONFLICT_MESSAGE),
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

	/** 404s a missing row; refuses a changed amount or date on a synced row. True when synced. */
	private async guardBankValues(
		id: number,
		{ amount, date }: Pick<TransactionUpdateInput, "amount" | "date">,
	): Promise<boolean> {
		const saved = await this.repository.findSyncedValues(id);
		if (!saved) throw new NotFoundError(NOT_FOUND_MESSAGE);
		if (saved.provenance === Provenance.Manual) return false;
		if (amount !== saved.amount || date.getTime() !== saved.date.getTime()) {
			throw new InvalidInputError(BANK_OWNED_MESSAGE);
		}
		return true;
	}

	// A linked Transaction takes its Category from the Expense (adr025), so
	// linking drops any Category sent. Unlinking with none sent keeps the old one.
	private async categoryPatch(
		{ expenseId, categoryId }: Partial<TransactionLink>,
		id?: number,
	): Promise<Pick<Partial<TransactionLink>, "categoryId">> {
		if (typeof expenseId === "number") return { categoryId: null };
		// Unlinked with no Category picked: keep showing the one it had.
		if (expenseId === null && categoryId === undefined && id !== undefined) {
			return { categoryId: await this.categoryBeforeUnlink(id) };
		}
		return {};
	}

	// The Category the row shows now: its Expense's if linked, else its own.
	// Null if the Expense is gone.
	private async categoryBeforeUnlink(id: number): Promise<number | null> {
		const link = await this.repository.findLink(id);
		if (!link) throw new NotFoundError(NOT_FOUND_MESSAGE);
		if (link.expenseId === null) return link.categoryId;
		const expenses = await this.expenses.namesByIds([link.expenseId]);
		return expenses.get(link.expenseId)?.categoryId ?? null;
	}
}
