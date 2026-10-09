import { describe, expect, it } from "vitest";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { recorder } from "~/test/fakes";
import type { IncomeService } from "./income.service";
import { incomeRouter } from "./income.trpc.controller";

const router = createTRPCRouter({ income: incomeRouter });

function callerWith(income: Partial<IncomeService>, session?: null) {
	return createTestCaller(router, { services: { income }, session });
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

describe("income router", () => {
	it("list returns the service's income", async () => {
		const { method, calls } = recorder([INCOME]);

		await expect(callerWith({ list: method }).income.list()).resolves.toEqual([
			INCOME,
		]);
		expect(calls).toEqual([[]]);
	});

	it("create hands the service the parsed input", async () => {
		const { method, calls } = recorder(INCOME);

		await expect(
			callerWith({ create: method }).income.create(FIELDS),
		).resolves.toEqual(INCOME);
		expect(calls).toEqual([[FIELDS]]);
	});

	it("rejects a one-time create with no amount before reaching the service", async () => {
		const { method, calls } = recorder(INCOME);

		await expect(
			callerWith({ create: method }).income.create({
				...FIELDS,
				kind: CommitmentKind.OneTime,
				expectedDate: new Date("2026-11-01T00:00:00.000Z"),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("update hands the service the parsed input, id included", async () => {
		const { method, calls } = recorder(INCOME);
		const input = { id: 4, ...FIELDS, kind: CommitmentKind.Recurring };

		await expect(
			callerWith({ update: method }).income.update(input),
		).resolves.toEqual(INCOME);
		expect(calls).toEqual([[input]]);
	});

	it("delete deletes by id and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }).income.delete({ id: 4 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[4]]);
	});

	it("surfaces update's missing-row error as INTERNAL_SERVER_ERROR", async () => {
		const update = async (): Promise<never> => {
			throw new Error("Failed to update income.");
		};

		await expect(
			callerWith({ update }).income.update({
				id: 4,
				...FIELDS,
				kind: CommitmentKind.Recurring,
			}),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update income.",
		});
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder([INCOME]);

		await expect(
			callerWith({ list: method }, null).income.list(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
