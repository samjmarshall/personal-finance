import { describe, expect, it } from "vitest";
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
		expect(notice?.detail).toContain("Everyday");
		expect(notice?.inRedBark).toBe(true);
	});

	it("joins several accounts with 'and' and reads right for more than one", () => {
		const savings = { accountId: "acc_2", accountName: "Savings", id: 2 };
		const expiring = CdrConnectionStatus.Expiring;
		expect(
			connectionNotice([
				account({ connectionStatus: expiring }),
				account({ ...savings, connectionStatus: expiring }),
			])?.detail,
		).toBe(
			"Everyday and Savings will lose access soon. Reauthorize in RedBark's dashboard to keep syncing.",
		);
		const revoked = CdrConnectionStatus.Revoked;
		expect(
			connectionNotice([
				account({ connectionStatus: revoked }),
				account({ ...savings, connectionStatus: revoked }),
			])?.detail,
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
		expect(notice?.inRedBark).toBe(true);
		expect(notice?.title).toMatch(/reauthorize/i);
		expect(notice?.detail).toContain("Everyday");
		expect(notice?.detail).not.toContain("Savings");
	});

	it("names an account by nickname, then bank name, then id", () => {
		const dead = CdrConnectionStatus.Revoked;
		const names = (overrides: Partial<CdrSyncState>) =>
			connectionNotice([account({ connectionStatus: dead, ...overrides })])
				?.detail;
		expect(names({ nickname: "Rent" })).toContain("Rent");
		expect(names({ accountName: null })).toContain("acc_1");
	});

	it("warns on an active account with an error, naming it and its last sync, not the error", () => {
		const notice = connectionNotice([
			account({ lastError: "ZodError: secret detail" }),
		]);
		expect(notice?.tone).toBe("warn");
		expect(notice?.detail).toContain("Everyday");
		expect(notice?.detail).toContain(formatDate("2026-10-18T03:00:00Z"));
		expect(notice?.detail).not.toContain("secret detail");
		expect(notice?.inRedBark).toBe(false);
	});

	it("says 'yet' when an erroring account has never synced", () => {
		const notice = connectionNotice([
			account({ lastError: "boom", lastSyncedAt: null }),
		]);
		expect(notice?.detail).toMatch(/yet/);
	});

	it("lets an alert win over a warning", () => {
		const notice = connectionNotice([
			account({ connectionStatus: CdrConnectionStatus.Expiring }),
			account({
				accountId: "acc_2",
				accountName: "Savings",
				connectionStatus: CdrConnectionStatus.Revoked,
				id: 2,
			}),
		]);
		expect(notice?.tone).toBe("alert");
	});
});
