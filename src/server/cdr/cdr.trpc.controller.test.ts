import { describe, expect, it } from "vitest";
import type { CdrImport, CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus, CdrImportStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { recorder, throwing } from "~/test/fakes";
import type { CdrService } from "./cdr.service";
import { cdrRouter } from "./cdr.trpc.controller";

const router = createTRPCRouter({ cdr: cdrRouter });

function callerWith(cdr: Partial<CdrService>, session?: null) {
	return createTestCaller(router, { services: { cdr }, session });
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
	createdAt: new Date("2026-10-28T00:00:00.000Z"),
	finishedAt: null,
} satisfies CdrImport;

describe("cdr router", () => {
	it("syncState returns the service's rows", async () => {
		const { method, calls } = recorder([SYNC_STATE]);

		await expect(
			callerWith({ listSyncState: method }).cdr.syncState(),
		).resolves.toEqual([SYNC_STATE]);
		expect(calls).toEqual([[]]);
	});

	it("setInBalance hands the service the parsed input", async () => {
		const { method, calls } = recorder({ ...SYNC_STATE, inBalance: false });
		const input = { accountId: "acc_1", inBalance: false };

		await callerWith({ setInBalance: method }).cdr.setInBalance(input);
		expect(calls).toEqual([[input]]);
	});

	it("rejects a non-boolean choice before reaching the service", async () => {
		const { method, calls } = recorder(SYNC_STATE);

		await expect(
			callerWith({ setInBalance: method }).cdr.setInBalance({
				accountId: "acc_1",
				inBalance: null,
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("surfaces a NotFoundError as NOT_FOUND", async () => {
		const setInBalance = throwing(new NotFoundError("unknown account"));

		await expect(
			callerWith({ setInBalance }).cdr.setInBalance({
				accountId: "acc_x",
				inBalance: true,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "unknown account" });
	});

	it("setNickname hands the service the trimmed name", async () => {
		const { method, calls } = recorder({ ...SYNC_STATE, nickname: "Bills" });

		await callerWith({ setNickname: method }).cdr.setNickname({
			accountId: "acc_1",
			nickname: "  Bills ",
		});
		expect(calls).toEqual([[{ accountId: "acc_1", nickname: "Bills" }]]);
	});

	it("setNickname surfaces an unknown account as NOT_FOUND", async () => {
		const setNickname = throwing(new NotFoundError("unknown account"));

		await expect(
			callerWith({ setNickname }).cdr.setNickname({
				accountId: "acc_x",
				nickname: "Bills",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "unknown account" });
	});

	it("startImport hands the service the parsed range", async () => {
		const { method, calls } = recorder(IMPORT);
		const input = { from: "2026-01-01", to: "2026-03-31" };

		await expect(
			callerWith({ startImport: method }).cdr.startImport(input),
		).resolves.toEqual(IMPORT);
		expect(calls).toEqual([[input]]);
	});

	it("startImport surfaces an active import as CONFLICT", async () => {
		const startImport = throwing(
			new ConflictError("An import is already running."),
		);

		await expect(
			callerWith({ startImport }).cdr.startImport({
				from: "2026-01-01",
				to: "2026-03-31",
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "An import is already running.",
		});
	});

	it("latestImport returns the service's row", async () => {
		const latest = { ...IMPORT, active: true };
		const { method, calls } = recorder(latest);

		await expect(
			callerWith({ latestImport: method }).cdr.latestImport(),
		).resolves.toEqual(latest);
		expect(calls).toEqual([[]]);
	});

	it.each([
		["syncState", (c: ReturnType<typeof callerWith>) => c.cdr.syncState()],
		[
			"startImport",
			(c: ReturnType<typeof callerWith>) =>
				c.cdr.startImport({ from: "2026-01-01", to: "2026-03-31" }),
		],
		[
			"latestImport",
			(c: ReturnType<typeof callerWith>) => c.cdr.latestImport(),
		],
		[
			"setInBalance",
			(c: ReturnType<typeof callerWith>) =>
				c.cdr.setInBalance({ accountId: "acc_1", inBalance: true }),
		],
		[
			"setNickname",
			(c: ReturnType<typeof callerWith>) =>
				c.cdr.setNickname({ accountId: "acc_1", nickname: "Bills" }),
		],
	])("rejects a signed-out %s before reaching the service", async (_, call) => {
		const list = recorder([SYNC_STATE]);
		const set = recorder(SYNC_STATE);
		const rename = recorder(SYNC_STATE);
		const start = recorder(IMPORT);
		const latest = recorder(null);

		await expect(
			call(
				callerWith(
					{
						listSyncState: list.method,
						setInBalance: set.method,
						setNickname: rename.method,
						startImport: start.method,
						latestImport: latest.method,
					},
					null,
				),
			),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect([
			...list.calls,
			...set.calls,
			...rename.calls,
			...start.calls,
			...latest.calls,
		]).toEqual([]);
	});
});
