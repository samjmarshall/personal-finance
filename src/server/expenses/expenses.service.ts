import type {
	CategoryCount,
	Expense,
	ExpenseCreateInput,
	ExpenseUpdateInput,
} from "~/domain/expenses";
import { assertRow } from "~/server/errors/assert-row";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import type { ExpensesRepository } from "./expenses.repository";

export interface ExpenseName {
	name: string;
	categoryId: number;
}

// The member deleted the picked Category in another tab.
const CATEGORY_GONE_MESSAGE = "The selected category no longer exists.";

const rethrowCategoryGone = (error: unknown): never =>
	rethrowFkConflict(error, CATEGORY_GONE_MESSAGE);

interface ExpensesServiceDeps {
	repository: ExpensesRepository;
}

export class ExpensesService {
	private readonly repository: ExpensesRepository;

	constructor({ repository }: ExpensesServiceDeps) {
		this.repository = repository;
	}

	list(): Promise<Expense[]> {
		return this.repository.list();
	}

	async create(input: ExpenseCreateInput): Promise<Expense> {
		const row = await this.repository.insert(input).catch(rethrowCategoryGone);
		return assertRow(row, "create expense");
	}

	// Missing id stays a 500, not "not found", to keep what members already see.
	async update({ id, ...values }: ExpenseUpdateInput): Promise<Expense> {
		const row = await this.repository
			.update(id, values)
			.catch(rethrowCategoryGone);
		return assertRow(row, "update expense");
	}

	delete(id: number): Promise<void> {
		return this.repository.delete(id);
	}

	countsByCategory(): Promise<CategoryCount[]> {
		return this.repository.countsByCategory();
	}

	// The batched lookup that replaces a cross-domain join (adr022): one call per
	// page, never per row. An id with no row has no entry. categoryId lets a
	// linked record show the Expense's Category (adr025).
	async namesByIds(ids: number[]): Promise<ReadonlyMap<number, ExpenseName>> {
		const rows = ids.length ? await this.repository.findNames(ids) : [];
		return new Map(
			rows.map(({ id, name, categoryId }) => [id, { name, categoryId }]),
		);
	}
}
