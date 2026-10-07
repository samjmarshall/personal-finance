import { describe, expect, it } from "vitest";
import type { CashflowResult } from "~/domain/cashflow";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { recorder } from "~/test/fakes";
import type { CashflowService } from "./cashflow.service";
import { cashflowRouter } from "./cashflow.trpc.controller";

const router = createTRPCRouter({ cashflow: cashflowRouter });

function callerWith(cashflow: Partial<CashflowService>, session?: null) {
	return createTestCaller(router, { services: { cashflow }, session });
}

const RESULT: CashflowResult = { buckets: [], hasBalanceAnchor: false };

describe("cashflow router", () => {
	it("get hands the service the period kind and returns its result", async () => {
		const { method, calls } = recorder(RESULT);

		await expect(
			callerWith({ get: method }).cashflow.get({ periodKind: "month" }),
		).resolves.toBe(RESULT);
		expect(calls).toEqual([["month"]]);
	});

	it("get defaults to the fortnight grid", async () => {
		const { method, calls } = recorder(RESULT);

		await callerWith({ get: method }).cashflow.get({});

		expect(calls).toEqual([["fortnight"]]);
	});

	it("rejects an unknown period kind before reaching the service", async () => {
		const { method, calls } = recorder(RESULT);

		await expect(
			callerWith({ get: method }).cashflow.get({ periodKind: "week" as never }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder(RESULT);

		await expect(
			callerWith({ get: method }, null).cashflow.get({}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
