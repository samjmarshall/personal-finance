import { describe, expect, it } from "vitest";
import type { Category } from "~/domain/categories";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { CategoriesRepository } from "./categories.repository";
import { CategoriesService } from "./categories.service";

function serviceWith(staged: Partial<CategoriesRepository>) {
	const repository: CategoriesRepository = {
		list: unstaged,
		nextSortOrder: unstaged,
		insert: unstaged,
		find: unstaged,
		update: unstaged,
		reorder: unstaged,
		delete: unstaged,
		findNames: unstaged,
		...staged,
	};
	return new CategoriesService({ repository });
}

const CATEGORY: Category = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const NAME_TAKEN_MESSAGE = "A category with that name already exists.";

describe("list", () => {
	it("returns the repository's categories", async () => {
		const rows = [CATEGORY];
		const service = serviceWith({ list: async () => rows });

		await expect(service.list()).resolves.toBe(rows);
	});
});

describe("create", () => {
	function creating(staged: Partial<CategoriesRepository> = {}) {
		const inserted: unknown[] = [];
		const service = serviceWith({
			nextSortOrder: async () => 4,
			insert: async (values) => {
				inserted.push(values);
				return CATEGORY;
			},
			...staged,
		});
		return { service, inserted };
	}

	it("trims the input and sorts the new category last", async () => {
		const { service, inserted } = creating();

		await expect(
			service.create({
				name: "  Food ",
				description: " Groceries and takeaway ",
			}),
		).resolves.toBe(CATEGORY);
		expect(inserted).toEqual([
			{ name: "Food", description: "Groceries and takeaway", sortOrder: 4 },
		]);
	});

	it("stores a blank or missing description as null", async () => {
		const { service, inserted } = creating();

		await service.create({ name: "Food", description: "   " });
		await service.create({ name: "Food" });

		expect(inserted).toEqual([
			{ name: "Food", description: null, sortOrder: 4 },
			{ name: "Food", description: null, sortOrder: 4 },
		]);
	});

	it("turns a duplicate name into a ConflictError", async () => {
		const error = failedQuery("23505");
		const { service } = creating({ insert: throwing(error) });

		const thrown = await service
			.create({ name: "Food" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message: NAME_TAKEN_MESSAGE, cause: error });
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23503");
		const { service } = creating({ insert: throwing(error) });

		await expect(service.create({ name: "Food" })).rejects.toBe(error);
	});

	it("throws a plain Error when the insert returns no row", async () => {
		const { service } = creating({ insert: async () => undefined });

		expectPlainError(
			await service.create({ name: "Food" }).catch((e: unknown) => e),
			"Failed to create category.",
		);
	});
});

describe("update", () => {
	function updating(staged: Partial<CategoriesRepository> = {}) {
		const updated: unknown[][] = [];
		const service = serviceWith({
			update: async (...args) => {
				updated.push(args);
				return CATEGORY;
			},
			...staged,
		});
		return { service, updated };
	}

	// Every other repository method is unstaged, so a second write would throw.
	it("trims the input and renames with one repository update", async () => {
		const { service, updated } = updating();

		await expect(
			service.update({ id: 3, name: " Groceries ", description: "  " }),
		).resolves.toBe(CATEGORY);
		expect(updated).toEqual([[3, { name: "Groceries", description: null }]]);
	});

	it("throws NotFoundError when no row was updated", async () => {
		const { service } = updating({ update: async () => undefined });

		const thrown = await service
			.update({ id: 3, name: "Food" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Category not found." });
	});

	it("turns a duplicate name into a ConflictError", async () => {
		const error = failedQuery("23505");
		const { service } = updating({ update: throwing(error) });

		const thrown = await service
			.update({ id: 3, name: "Groceries" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message: NAME_TAKEN_MESSAGE, cause: error });
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23503");
		const { service } = updating({ update: throwing(error) });

		await expect(service.update({ id: 3, name: "Groceries" })).rejects.toBe(
			error,
		);
	});
});

describe("reorder", () => {
	it("hands the repository the ids in order", async () => {
		const reordered: number[][] = [];
		const service = serviceWith({
			reorder: async (ids) => {
				reordered.push(ids);
			},
		});

		await service.reorder([3, 1, 2]);

		expect(reordered).toEqual([[3, 1, 2]]);
	});
});

describe("delete", () => {
	function deleting(staged: Partial<CategoriesRepository> = {}) {
		const deleted: number[] = [];
		const service = serviceWith({
			find: async () => CATEGORY,
			delete: async (id) => {
				deleted.push(id);
			},
			...staged,
		});
		return { service, deleted };
	}

	it("deletes by id", async () => {
		const { service, deleted } = deleting();

		await service.delete(3);

		expect(deleted).toEqual([3]);
	});

	it("throws NotFoundError for a missing id and never deletes", async () => {
		const { service, deleted } = deleting({ find: async () => undefined });

		const thrown = await service.delete(3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Category not found." });
		expect(deleted).toEqual([]);
	});

	it("turns an in-use FK violation (23503) into a ConflictError", async () => {
		const error = failedQuery("23503");
		const { service } = deleting({ delete: throwing(error) });

		const thrown = await service.delete(3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: 'Cannot delete "Food" — expenses still use it.',
			cause: error,
		});
	});

	it("rethrows any other error unchanged", async () => {
		const error = new Error("connection lost");
		const { service } = deleting({ delete: throwing(error) });

		await expect(service.delete(3)).rejects.toBe(error);
	});
});

describe("namesByIds", () => {
	it("asks the repository for the ids and maps the rows by id", async () => {
		const asked: number[][] = [];
		const service = serviceWith({
			findNames: async (ids) => {
				asked.push(ids);
				return [{ id: 3, name: "Food" }];
			},
		});

		await expect(service.namesByIds([3, 4])).resolves.toEqual(
			new Map([[3, "Food"]]),
		);
		expect(asked).toEqual([[3, 4]]);
	});

	// The unstaged default throws, so a lookup run for no ids would fail here.
	it("gives an empty map for no ids without querying", async () => {
		await expect(serviceWith({}).namesByIds([])).resolves.toEqual(new Map());
	});

	it("lets a lookup error propagate", async () => {
		const error = new Error("connection lost");
		const service = serviceWith({ findNames: throwing(error) });

		await expect(service.namesByIds([3])).rejects.toBe(error);
	});
});
