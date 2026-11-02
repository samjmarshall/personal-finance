import { describe, expect, it } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import { BalanceSource } from "~/lib/constants";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { BalancesRepository } from "./balances.repository";
import { BalancesService } from "./balances.service";

function serviceWith(staged: Partial<BalancesRepository>) {
	const repository: BalancesRepository = {
		findLatest: unstaged,
		insert: unstaged,
		...staged,
	};
	return new BalancesService({ repository });
}

const SNAPSHOT: BalanceSnapshot = {
	id: 7,
	amount: 12500.5,
	asOf: new Date("2026-10-01T00:00:00.000Z"),
	createdAt: new Date("2026-10-01T01:00:00.000Z"),
	source: BalanceSource.Manual,
};

const INPUT = { amount: 12500.5, asOf: SNAPSHOT.asOf };

describe("BalancesService", () => {
	it("latest returns the repository's newest snapshot", async () => {
		const service = serviceWith({ findLatest: async () => SNAPSHOT });

		await expect(service.latest()).resolves.toBe(SNAPSHOT);
	});

	it("latest gives null when there are no snapshots", async () => {
		const service = serviceWith({ findLatest: async () => undefined });

		await expect(service.latest()).resolves.toBeNull();
	});

	it("set inserts the input labelled manual and returns the stored row", async () => {
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);
				return SNAPSHOT;
			},
		});

		await expect(service.set(INPUT)).resolves.toBe(SNAPSHOT);
		expect(inserted).toEqual([{ ...INPUT, source: BalanceSource.Manual }]);
	});

	it("set throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		const thrown = await service.set(INPUT).catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to set balance.");
	});

	it("set lets a driver error through unchanged", async () => {
		const error = failedQuery("23502");
		const service = serviceWith({ insert: throwing(error) });

		await expect(service.set(INPUT)).rejects.toBe(error);
	});

	it("recordSynced inserts the input labelled cdr and returns the stored row", async () => {
		const synced = { ...SNAPSHOT, source: BalanceSource.Cdr };
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);
				return synced;
			},
		});

		await expect(service.recordSynced(INPUT)).resolves.toBe(synced);
		expect(inserted).toEqual([{ ...INPUT, source: BalanceSource.Cdr }]);
	});

	it("recordSynced throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		const thrown = await service.recordSynced(INPUT).catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to record synced balance.");
	});
});
