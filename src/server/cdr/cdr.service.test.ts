import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdrImport, CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus, CdrImportStatus } from "~/lib/constants";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import { recorder, unstaged } from "~/test/fakes";
import type { CdrRepository } from "./cdr.repository";
import { CdrService } from "./cdr.service";

function serviceWith(staged: Partial<CdrRepository>) {
	const repository: CdrRepository = {
		listSyncState: unstaged,
		upsertAccount: unstaged,
		advanceHighWaterMark: unstaged,
		setConnectionStatus: unstaged,
		recordError: unstaged,
		setInBalance: unstaged,
		recordBalance: unstaged,
		setNickname: unstaged,
		insertImport: unstaged,
		findActiveImport: unstaged,
		latestImport: unstaged,
		markImportRunning: unstaged,
		addImportCounts: unstaged,
		finishImport: unstaged,
		failImport: unstaged,
		...staged,
	};

	return new CdrService({ repository });
}

const SYNC_STATE = {
	id: 1,
	accountId: "acc_1",
	accountName: "Everyday",
	accountNumber: "xxxx8273",
	balance: 5489.69,
	balanceAsOf: new Date("2026-10-18T18:00:00.000Z"),
	connectionId: "conn_1",
	connectionStatus: CdrConnectionStatus.Active,
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	highWaterMark: new Date("2026-10-15T00:00:00.000Z"),
	inBalance: true,
	institutionName: "CommBank",
	lastError: null,
	lastSyncedAt: new Date("2026-10-18T18:00:00.000Z"),
	nickname: null,
	updatedAt: null,
} satisfies CdrSyncState;

describe("CdrService.listSyncState", () => {
	it("returns the repository's rows", async () => {
		const service = serviceWith({ listSyncState: async () => [SYNC_STATE] });

		await expect(service.listSyncState()).resolves.toEqual([SYNC_STATE]);
	});
});

describe("CdrService.setInBalance", () => {
	it("saves the choice and returns the row", async () => {
		const saved = { ...SYNC_STATE, inBalance: false };
		const { method, calls } = recorder(saved);
		const service = serviceWith({ setInBalance: method });

		await expect(
			service.setInBalance({ accountId: "acc_1", inBalance: false }),
		).resolves.toBe(saved);
		expect(calls).toEqual([["acc_1", false]]);
	});

	it("throws NotFoundError for an account the sync hasn't saved", async () => {
		const service = serviceWith({ setInBalance: async () => undefined });

		await expect(
			service.setInBalance({ accountId: "acc_x", inBalance: true }),
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

describe("CdrService.setNickname", () => {
	it("saves the nickname and returns the row", async () => {
		const saved = { ...SYNC_STATE, nickname: "Bills" };
		const { method, calls } = recorder(saved);
		const service = serviceWith({ setNickname: method });

		await expect(
			service.setNickname({ accountId: "acc_1", nickname: "Bills" }),
		).resolves.toBe(saved);
		expect(calls).toEqual([["acc_1", "Bills"]]);
	});

	it("throws NotFoundError for an account the sync hasn't saved", async () => {
		const service = serviceWith({ setNickname: async () => undefined });

		await expect(
			service.setNickname({ accountId: "acc_x", nickname: null }),
		).rejects.toBeInstanceOf(NotFoundError);
	});
});

// 2026-10-28 11:00 in Sydney (AEDT, UTC+11).
const NOW = new Date("2026-10-28T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const IMPORT = {
	id: 7,
	fromDate: new Date("2026-01-01T00:00:00.000Z"),
	toDate: new Date("2026-03-31T00:00:00.000Z"),
	status: CdrImportStatus.Queued,
	added: 0,
	adopted: 0,
	flagged: 0,
	known: 0,
	error: null,
	createdAt: NOW,
	finishedAt: null,
} satisfies CdrImport;

describe("CdrService.startImport", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("inserts the range as UTC midnights when nothing is running", async () => {
		const active = recorder(undefined);
		const insert = recorder(IMPORT);
		const service = serviceWith({
			findActiveImport: active.method,
			insertImport: insert.method,
		});

		await expect(
			service.startImport({ from: "2026-01-01", to: "2026-03-31" }),
		).resolves.toBe(IMPORT);
		expect(insert.calls).toEqual([
			[
				{
					fromDate: new Date("2026-01-01T00:00:00.000Z"),
					toDate: new Date("2026-03-31T00:00:00.000Z"),
				},
			],
		]);
	});

	// 2 am on the 28th in Sydney is still the 27th in UTC.
	it("takes today in Sydney as the latest `to`", async () => {
		vi.setSystemTime(new Date("2026-10-27T15:00:00.000Z"));
		const service = serviceWith({
			findActiveImport: async () => undefined,
			insertImport: async () => IMPORT,
		});

		await expect(
			service.startImport({ from: "2026-10-01", to: "2026-10-28" }),
		).resolves.toBe(IMPORT);
	});

	it.each([
		["`from` after `to`", "2026-03-02", "2026-03-01"],
		["`to` after today", "2026-10-01", "2026-10-29"],
		["`from` over 7 years ago", "2019-10-27", "2026-10-28"],
	])("refuses %s", async (_, from, to) => {
		const service = serviceWith({});

		await expect(service.startImport({ from, to })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
	});

	it("allows `from` exactly 7 years ago", async () => {
		const service = serviceWith({
			findActiveImport: async () => undefined,
			insertImport: async () => IMPORT,
		});

		await expect(
			service.startImport({ from: "2019-10-28", to: "2026-10-28" }),
		).resolves.toBe(IMPORT);
	});

	it("refuses while an import is active, looking back 24 hours", async () => {
		const active = recorder({ ...IMPORT, status: CdrImportStatus.Running });
		const service = serviceWith({ findActiveImport: active.method });

		await expect(
			service.startImport({ from: "2026-01-01", to: "2026-03-31" }),
		).rejects.toBeInstanceOf(ConflictError);
		expect(active.calls).toEqual([[new Date(NOW.getTime() - 24 * HOUR_MS)]]);
	});
});

describe("CdrService.latestImport", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const createdAgo = (hours: number) =>
		new Date(NOW.getTime() - hours * HOUR_MS);

	it("is null when nothing was ever imported", async () => {
		const service = serviceWith({ latestImport: async () => undefined });

		await expect(service.latestImport()).resolves.toBeNull();
	});

	it("is active while running and just under 24 hours old", async () => {
		const row = {
			...IMPORT,
			status: CdrImportStatus.Running,
			createdAt: createdAgo(23.9),
		};
		const service = serviceWith({ latestImport: async () => row });

		await expect(service.latestImport()).resolves.toEqual({
			...row,
			active: true,
		});
	});

	// Its job may never report, so the page mustn't lock on it.
	it("is not active once a running row is just over 24 hours old", async () => {
		const row = {
			...IMPORT,
			status: CdrImportStatus.Running,
			createdAt: createdAgo(24.1),
		};
		const service = serviceWith({ latestImport: async () => row });

		await expect(service.latestImport()).resolves.toMatchObject({
			active: false,
		});
	});

	it("is not active once done", async () => {
		const row = { ...IMPORT, status: CdrImportStatus.Done };
		const service = serviceWith({ latestImport: async () => row });

		await expect(service.latestImport()).resolves.toMatchObject({
			active: false,
		});
	});
});
