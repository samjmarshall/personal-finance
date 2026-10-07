import { describe, expect, it } from "vitest";
import type { Category } from "~/domain/categories";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { recorder, throwing } from "~/test/fakes";
import type { CategoriesService } from "./categories.service";
import { categoryRouter } from "./categories.trpc.controller";

const router = createTRPCRouter({ category: categoryRouter });

function callerWith(categories: Partial<CategoriesService>, session?: null) {
	return createTestCaller(router, { services: { categories }, session });
}

const CATEGORY: Category = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

describe("category router", () => {
	it("list returns the service's categories", async () => {
		const rows = [{ ...CATEGORY, expenseCount: 2 }];
		const { method } = recorder(rows);

		await expect(callerWith({ list: method }).category.list()).resolves.toEqual(
			rows,
		);
	});

	it("create hands the service the parsed input", async () => {
		const { method, calls } = recorder(CATEGORY);
		const input = { name: "Food", description: "Groceries and takeaway" };

		await expect(
			callerWith({ create: method }).category.create(input),
		).resolves.toEqual(CATEGORY);
		expect(calls).toEqual([[input]]);
	});

	it("update hands the service the parsed input, id included", async () => {
		const { method, calls } = recorder(CATEGORY);
		const input = { id: 3, name: "Food" };

		await expect(
			callerWith({ update: method }).category.update(input),
		).resolves.toEqual(CATEGORY);
		expect(calls).toEqual([[input]]);
	});

	it("reorder hands the service the ids and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ reorder: method }).category.reorder({
				ids: [3, 1, 2],
			}),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[[3, 1, 2]]]);
	});

	it("delete deletes by id and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }).category.delete({ id: 3 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[3]]);
	});

	it("surfaces a NotFoundError as NOT_FOUND", async () => {
		const update = throwing(new NotFoundError("Category not found."));

		await expect(
			callerWith({ update }).category.update({ id: 3, name: "Food" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Category not found.",
		});
	});

	it("surfaces a ConflictError as CONFLICT", async () => {
		const message = 'Cannot delete "Food" — 2 expenses still use it.';
		const deleteCategory = throwing(new ConflictError(message));

		await expect(
			callerWith({ delete: deleteCategory }).category.delete({ id: 3 }),
		).rejects.toMatchObject({ code: "CONFLICT", message });
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }, null).category.delete({ id: 3 }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
