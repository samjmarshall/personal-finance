import { describe, expect, it } from "vitest";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { failedQuery, throwing, unstaged } from "~/test/fakes";
import type { IncomeRepository } from "./income.repository";
import { IncomeService } from "./income.service";

function serviceWith(staged: Partial<IncomeRepository>) {
	const repository: IncomeRepository = {
		list: unstaged,
		insert: unstaged,
		update: unstaged,
		delete: unstaged,
		...staged,
	};
	return new IncomeService({ repository });
}

const INCOME: Income = {
	id: 4,
	person: "Alex",
	source: "Salary",
	kind: CommitmentKind.Recurring,
	fortnight: 3000,
	month: 6500,
	year: 78000,
	amount: null,
	expectedDate: null,
	dueDay: null,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const FIELDS = { person: "Alex", source: "Salary" };

function expectPlainError(thrown: unknown, message: string) {
	expect(Object.getPrototypeOf(thrown)).toBe(Error.prototype);
	expect(thrown).toMatchObject({ message });
}

describe("IncomeService", () => {
	it("list returns the repository's income", async () => {
		const rows = [INCOME];
		const service = serviceWith({ list: async () => rows });

		await expect(service.list()).resolves.toBe(rows);
	});

	it("create inserts the input and returns the stored row", async () => {
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);
				return INCOME;
			},
		});

		await expect(service.create(FIELDS)).resolves.toBe(INCOME);
		expect(inserted).toEqual([FIELDS]);
	});

	it("create throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		expectPlainError(
			await service.create(FIELDS).catch((e: unknown) => e),
			"Failed to create income.",
		);
	});

	it("create lets a driver error through unchanged", async () => {
		const error = failedQuery("23502");
		const service = serviceWith({ insert: throwing(error) });

		await expect(service.create(FIELDS)).rejects.toBe(error);
	});

	it("update updates the row by id with the other fields", async () => {
		const updated: unknown[][] = [];
		const service = serviceWith({
			update: async (id, values) => {
				updated.push([id, values]);
				return INCOME;
			},
		});
		const values = { ...FIELDS, kind: CommitmentKind.Recurring };

		await expect(service.update({ id: 4, ...values })).resolves.toBe(INCOME);
		expect(updated).toEqual([[4, values]]);
	});

	it("update throws a plain Error, not NotFoundError, when no row matches", async () => {
		const service = serviceWith({ update: async () => undefined });

		expectPlainError(
			await service
				.update({ id: 4, ...FIELDS, kind: CommitmentKind.Recurring })
				.catch((e: unknown) => e),
			"Failed to update income.",
		);
	});

	it("delete deletes by id", async () => {
		const deleted: number[] = [];
		const service = serviceWith({
			delete: async (id) => {
				deleted.push(id);
			},
		});

		await service.delete(4);

		expect(deleted).toEqual([4]);
	});
});
