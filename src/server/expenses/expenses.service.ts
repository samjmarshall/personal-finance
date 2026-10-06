import type {
	Category,
	CategoryCreateInput,
	CategoryUpdateInput,
} from "~/domain/categories";
import type {
	Expense,
	ExpenseCreateInput,
	ExpenseUpdateInput,
} from "~/domain/expenses";
import { assertRow } from "~/server/errors/assert-row";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type {
	CategoryValues,
	ExpensesRepository,
	NameRow,
} from "./expenses.repository";

const CATEGORY_NAME_TAKEN_MESSAGE = "A category with that name already exists.";
const CATEGORY_NOT_FOUND_MESSAGE = "Category not found.";
const categoryInUseMessage = (name: string, count: number) =>
	`Cannot delete "${name}" — ${count} expense${count === 1 ? "" : "s"} still use it.`;

// Category names are unique, so a unique violation on a category write is a
// name clash the member can fix. Anything else passes through untouched.
function rethrowNameTaken(error: unknown): never {
	if (isPgViolation(error, PgViolation.UniqueViolation)) {
		throw new ConflictError(CATEGORY_NAME_TAKEN_MESSAGE, { cause: error });
	}
	throw error;
}

function normalizeCategory({
	name,
	description,
}: CategoryCreateInput): CategoryValues {
	return { name: name.trim(), description: description?.trim() || null };
}

/** An id with no row has no entry. */
export interface NamesById {
	expenses: ReadonlyMap<number, string>;
	categories: ReadonlyMap<number, string>;
}

const toNameMap = (rows: NameRow[]) =>
	new Map(rows.map(({ id, name }) => [id, name]));

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
		return assertRow(await this.repository.insert(input), "create expense");
	}

	// Missing id stays a 500, not "not found", to keep what members already see.
	async update({ id, ...values }: ExpenseUpdateInput): Promise<Expense> {
		return assertRow(
			await this.repository.update(id, values),
			"update expense",
		);
	}

	delete(id: number): Promise<void> {
		return this.repository.delete(id);
	}

	listCategories(): Promise<Category[]> {
		return this.repository.listCategories();
	}

	async createCategory(input: CategoryCreateInput): Promise<Category> {
		const sortOrder = await this.repository.nextCategorySortOrder();
		const row = await this.repository
			.insertCategory({ ...normalizeCategory(input), sortOrder })
			.catch(rethrowNameTaken);
		return assertRow(row, "create category");
	}

	async updateCategory({
		id,
		...input
	}: CategoryUpdateInput): Promise<Category> {
		const existing = await this.findCategoryOrThrow(id);
		const row = await this.repository
			.updateCategory(id, normalizeCategory(input), existing.name)
			.catch(rethrowNameTaken);
		return assertRow(row, "update category");
	}

	reorderCategories(ids: number[]): Promise<void> {
		return this.repository.reorderCategories(ids);
	}

	async deleteCategory(id: number): Promise<void> {
		const existing = await this.findCategoryOrThrow(id);
		const count = await this.repository.countExpensesInCategory(existing.name);
		if (count > 0) {
			throw new ConflictError(categoryInUseMessage(existing.name, count));
		}
		await this.repository.deleteCategory(id);
	}

	// The batched lookup that replaces a cross-domain join (adr022): one call per
	// page, never per row.
	async namesByIds({
		expenseIds,
		categoryIds,
	}: {
		expenseIds: number[];
		categoryIds: number[];
	}): Promise<NamesById> {
		const [expenseRows, categoryRows] = await Promise.all([
			expenseIds.length ? this.repository.findExpenseNames(expenseIds) : [],
			categoryIds.length ? this.repository.findCategoryNames(categoryIds) : [],
		]);
		return {
			expenses: toNameMap(expenseRows),
			categories: toNameMap(categoryRows),
		};
	}

	private async findCategoryOrThrow(id: number): Promise<Category> {
		const existing = await this.repository.findCategory(id);
		if (!existing) throw new NotFoundError(CATEGORY_NOT_FOUND_MESSAGE);
		return existing;
	}
}
