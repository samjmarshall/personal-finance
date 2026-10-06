import { describe, expect, it } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { recorder } from "~/test/fakes";
import type { BalancesService } from "./balances.service";
import { balanceRouter } from "./balances.trpc.controller";

const router = createTRPCRouter({ balance: balanceRouter });

function callerWith(balances: Partial<BalancesService>, session?: null) {
	return createTestCaller(router, { services: { balances }, session });
}

const SNAPSHOT: BalanceSnapshot = {
	id: 7,
	amount: 12500.5,
	asOf: new Date("2026-10-01T00:00:00.000Z"),
	createdAt: new Date("2026-10-01T01:00:00.000Z"),
};

describe("balance router", () => {
	it("latest returns the service's snapshot", async () => {
		const { method, calls } = recorder(SNAPSHOT);

		await expect(
			callerWith({ latest: method }).balance.latest(),
		).resolves.toEqual(SNAPSHOT);
		expect(calls).toEqual([[]]);
	});

	it("set hands the service the parsed input", async () => {
		const { method, calls } = recorder(SNAPSHOT);
		const input = { amount: 12500.5, asOf: SNAPSHOT.asOf };

		await expect(
			callerWith({ set: method }).balance.set(input),
		).resolves.toEqual(SNAPSHOT);
		expect(calls).toEqual([[input]]);
	});

	it("rejects a set with no amount before reaching the service", async () => {
		const { method, calls } = recorder(SNAPSHOT);

		await expect(
			callerWith({ set: method }).balance.set({ asOf: SNAPSHOT.asOf } as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder(SNAPSHOT);

		await expect(
			callerWith({ latest: method }, null).balance.latest(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
