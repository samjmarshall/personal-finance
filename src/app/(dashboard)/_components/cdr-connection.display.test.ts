import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import { connectionNotice } from "./cdr-connection.display";

function account(overrides: Partial<CdrSyncState> = {}): CdrSyncState {
	return {
		accountId: "acc_1",
		accountName: "Everyday",
		accountNumber: null,
		balance: null,
		balanceAsOf: null,
		connectionId: "con_1",
		connectionStatus: CdrConnectionStatus.Active,
		createdAt: new Date("2026-10-01T00:00:00Z"),
		highWaterMark: null,
		id: 1,
		inBalance: true,
		institutionName: null,
		lastError: null,
		lastSyncedAt: new Date("2026-10-18T03:00:00Z"),
		nickname: null,
		updatedAt: null,
		...overrides,
	};
}

describe("connectionNotice", () => {
	// A day after the fixture's last sync, so a healthy account isn't stale.
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-19T03:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is null with no accounts", () => {
		expect(connectionNotice([])).toBeNull();
	});

	it.each([CdrConnectionStatus.Active, CdrConnectionStatus.Pending])(
		"is null for a healthy %s account",
		(connectionStatus) => {
			expect(connectionNotice([account({ connectionStatus })])).toBeNull();
		},
	);

	it("warns softly when a connection is expiring", () => {
		const notice = connectionNotice([
			account({ connectionStatus: CdrConnectionStatus.Expiring }),
		]);
		expect(notice?.tone).toBe("warn");
		expect(notice?.reauthorize).toContain("Everyday");
		expect(notice?.title).toBe("Bank connection expiring");
	});

	it("joins several accounts with 'and' and reads right for more than one", () => {
		const savings = { accountId: "acc_2", accountName: "Savings", id: 2 };
		const expiring = CdrConnectionStatus.Expiring;
		expect(
			connectionNotice([
				account({ connectionStatus: expiring }),
				account({ ...savings, connectionStatus: expiring }),
			])?.reauthorize,
		).toBe(
			"Everyday and Savings will lose access soon. Reauthorize in RedBark's dashboard to keep syncing.",
		);
		const revoked = CdrConnectionStatus.Revoked;
		expect(
			connectionNotice([
				account({ connectionStatus: revoked }),
				account({ ...savings, connectionStatus: revoked }),
			])?.reauthorize,
		).toBe(
			"Syncing has stopped for Everyday and Savings. Reauthorize in RedBark's dashboard and it picks up where it left off.",
		);
	});

	it.each([
		CdrConnectionStatus.Expired,
		CdrConnectionStatus.Revoked,
		CdrConnectionStatus.Invalidated,
	])("alerts on a %s connection and says to reauthorize it", (status) => {
		const notice = connectionNotice([
			account({ connectionStatus: status }),
			account({ accountId: "acc_2", accountName: "Savings", id: 2 }),
		]);
		expect(notice?.tone).toBe("alert");
		expect(notice?.title).toMatch(/reauthorize/i);
		expect(notice?.reauthorize).toContain("Everyday");
		expect(notice?.reauthorize).not.toContain("Savings");
		expect(notice?.behind).toBeNull();
	});

	it("pluralises the title by connection, not by account", () => {
		const savings = { accountId: "acc_2", accountName: "Savings", id: 2 };
		const revoked = CdrConnectionStatus.Revoked;
		const expiring = CdrConnectionStatus.Expiring;
		expect(
			connectionNotice([
				account({ connectionStatus: revoked }),
				account({ ...savings, connectionStatus: revoked }),
			])?.title,
		).toBe("Reauthorize your bank connection");
		expect(
			connectionNotice([
				account({ connectionStatus: revoked }),
				account({
					...savings,
					connectionId: "con_2",
					connectionStatus: revoked,
				}),
			])?.title,
		).toBe("Reauthorize your bank connections");
		expect(
			connectionNotice([
				account({ connectionStatus: expiring }),
				account({
					...savings,
					connectionId: "con_2",
					connectionStatus: expiring,
				}),
			])?.title,
		).toBe("Bank connections expiring");
	});

	it("names an account by nickname, then bank name, then id", () => {
		const dead = CdrConnectionStatus.Revoked;
		const names = (overrides: Partial<CdrSyncState>) =>
			connectionNotice([account({ connectionStatus: dead, ...overrides })])
				?.reauthorize;
		expect(names({ nickname: "Rent" })).toContain("Rent");
		expect(names({ accountName: null })).toContain("acc_1");
	});

	it("adds the masked number only when accounts share a name", () => {
		const notice = connectionNotice([
			account({
				accountNumber: "xxxx1111",
				connectionStatus: CdrConnectionStatus.Revoked,
			}),
			account({
				accountId: "acc_2",
				accountNumber: "xxxx2222",
				id: 2,
				lastError: "boom",
			}),
			account({
				accountId: "acc_3",
				accountName: "Savings",
				accountNumber: "xxxx3333",
				id: 3,
				lastError: "boom",
			}),
		]);
		expect(notice?.reauthorize).toContain(
			"Syncing has stopped for Everyday (xxxx1111).",
		);
		expect(notice?.behind).toContain("Everyday (xxxx2222) hasn't synced");
		expect(notice?.behind).toContain("Savings hasn't synced");
	});

	it("warns on an active account with an error, naming it and its last sync, not the error", () => {
		const notice = connectionNotice([
			account({ lastError: "ZodError: secret detail" }),
		]);
		expect(notice?.tone).toBe("warn");
		expect(notice?.behind).toContain("Everyday");
		expect(notice?.behind).toContain(formatDate("2026-10-18T03:00:00Z"));
		expect(notice?.behind).not.toContain("secret detail");
		expect(notice?.reauthorize).toBeNull();
	});

	it("says 'yet' when an erroring account has never synced", () => {
		const notice = connectionNotice([
			account({ lastError: "boom", lastSyncedAt: null }),
		]);
		expect(notice?.behind).toMatch(/yet/);
	});

	it("warns when no live account has synced for over two days, though none has an error", () => {
		vi.setSystemTime(new Date("2026-10-20T03:00:01Z"));
		const notice = connectionNotice([
			account({ lastSyncedAt: new Date("2026-10-17T03:00:00Z") }),
			account({ accountId: "acc_2", accountName: "Savings", id: 2 }),
		]);
		expect(notice?.tone).toBe("warn");
		expect(notice?.title).toBe("Bank sync is behind");
		expect(notice?.behind).toBe(
			`No bank account has synced since ${formatDate("2026-10-18T03:00:00Z")}.`,
		);
	});

	it("is null when the newest sync is exactly two days old", () => {
		vi.setSystemTime(new Date("2026-10-20T03:00:00Z"));
		expect(connectionNotice([account()])).toBeNull();
	});

	it("dates a never-synced live account from when it was found", () => {
		vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
		expect(connectionNotice([account({ lastSyncedAt: null })])?.behind).toBe(
			"No bank account has synced yet.",
		);
	});

	it("ignores pending and dead accounts when judging a stalled sync", () => {
		vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
		expect(
			connectionNotice([
				account({ connectionStatus: CdrConnectionStatus.Pending }),
			]),
		).toBeNull();
	});

	it("lets an alert win the tone and title but keeps other banks' warnings", () => {
		const notice = connectionNotice([
			account({ connectionStatus: CdrConnectionStatus.Expiring }),
			account({
				accountId: "acc_2",
				accountName: "Savings",
				connectionStatus: CdrConnectionStatus.Revoked,
				id: 2,
			}),
			account({
				accountId: "acc_3",
				accountName: "Bills",
				id: 3,
				lastError: "boom",
			}),
		]);
		expect(notice?.tone).toBe("alert");
		expect(notice?.title).toBe("Reauthorize your bank connection");
		expect(notice?.reauthorize).toContain("Syncing has stopped for Savings.");
		expect(notice?.reauthorize).toContain("Everyday will lose access soon.");
		expect(notice?.behind).toContain("Bills hasn't synced since");
	});

	it("titles an expiry over a stuck account, keeping the reauthorize line apart", () => {
		const notice = connectionNotice([
			account({ connectionStatus: CdrConnectionStatus.Expiring }),
			account({
				accountId: "acc_2",
				accountName: "Savings",
				id: 2,
				lastError: "boom",
			}),
		]);
		expect(notice?.tone).toBe("warn");
		expect(notice?.title).toBe("Bank connection expiring");
		expect(notice?.reauthorize).toBe(
			"Everyday will lose access soon. Reauthorize in RedBark's dashboard to keep syncing.",
		);
		expect(notice?.behind).toBe(
			`Savings hasn't synced since ${formatDate("2026-10-18T03:00:00Z")}.`,
		);
	});

	it("doesn't call a dead account behind as well as stopped", () => {
		const notice = connectionNotice([
			account({
				connectionStatus: CdrConnectionStatus.Revoked,
				lastError: "boom",
			}),
		]);
		expect(notice?.behind).toBeNull();
	});
});
