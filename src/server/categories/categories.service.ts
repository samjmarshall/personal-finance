import type {
	Category,
	CategoryCreateInput,
	CategoryUpdateInput,
} from "~/domain/categories";
import { assertRow } from "~/server/errors/assert-row";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type {
	CategoriesRepository,
	CategoryValues,
} from "./categories.repository";

const NAME_TAKEN_MESSAGE = "A category with that name already exists.";
const NOT_FOUND_MESSAGE = "Category not found.";
const inUseMessage = (name: string) =>
	`Cannot delete "${name}" — expenses still use it.`;

// Category names are unique, so a unique violation on a category write is a
// name clash the member can fix. Anything else passes through untouched.
function rethrowNameTaken(error: unknown): never {
	if (isPgViolation(error, PgViolation.UniqueViolation)) {
		throw new ConflictError(NAME_TAKEN_MESSAGE, { cause: error });
	}
	throw error;
}

function normalize({ name, description }: CategoryCreateInput): CategoryValues {
	return { name: name.trim(), description: description?.trim() || null };
}

interface CategoriesServiceDeps {
	repository: CategoriesRepository;
}

// The bottom of the service graph: other services call it, it calls none.
export class CategoriesService {
	private readonly repository: CategoriesRepository;

	constructor({ repository }: CategoriesServiceDeps) {
		this.repository = repository;
	}

	list(): Promise<Category[]> {
		return this.repository.list();
	}

	async create(input: CategoryCreateInput): Promise<Category> {
		const sortOrder = await this.repository.nextSortOrder();
		const row = await this.repository
			.insert({ ...normalize(input), sortOrder })
			.catch(rethrowNameTaken);
		return assertRow(row, "create category");
	}

	async update({ id, ...input }: CategoryUpdateInput): Promise<Category> {
		const row = await this.repository
			.update(id, normalize(input))
			.catch(rethrowNameTaken);
		if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return row;
	}

	reorder(ids: number[]): Promise<void> {
		return this.repository.reorder(ids);
	}

	// The database refuses while an Expense uses it (adr024). Transactions and
	// receipt items just lose their Category.
	async delete(id: number): Promise<void> {
		const existing = await this.findOrThrow(id);
		await this.repository
			.delete(id)
			.catch((error: unknown) =>
				rethrowFkConflict(error, inUseMessage(existing.name)),
			);
	}

	// The batched lookup that replaces a cross-domain join (adr022): one call per
	// page, never per row. An id with no row has no entry.
	async namesByIds(ids: number[]): Promise<ReadonlyMap<number, string>> {
		const rows = ids.length ? await this.repository.findNames(ids) : [];
		return new Map(rows.map(({ id, name }) => [id, name]));
	}

	private async findOrThrow(id: number): Promise<Category> {
		const existing = await this.repository.find(id);
		if (!existing) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return existing;
	}
}
