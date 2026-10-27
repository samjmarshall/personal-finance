import { describe, expect, it } from "vitest";
import type { CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import { NotFoundError } from "~/server/errors/domain-errors";
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
