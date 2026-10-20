import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CdrSyncState,
	RedbarkAccount,
	RedbarkConnection,
	RedbarkTransaction,
} from "~/domain/cdr";
import type { SyncedTransaction } from "~/domain/transactions";
import { CdrConnectionStatus, Provenance } from "~/lib/constants";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { CdrSyncError } from "./cdr.errors";
import { type RedbarkClient, RedbarkRetryableError } from "./cdr.redbark";
import type { CdrRepository } from "./cdr.repository";
import { CdrSyncService } from "./cdr-sync.service";

const NOW = new Date("2026-10-20T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (date: Date, days: number) =>
	new Date(date.getTime() - days * DAY_MS);

type LogEntry = { level: string; msg: string; attrs: LogAttributes };

const row = (id: string, date: string, amount = -1000): RedbarkTransaction => ({
	id,
	account: "acct_1",
	status: "posted",
	date,
	description: `row ${id}`,
	amount: { amount, currency: "aud" },
	direction: amount < 0 ? "debit" : "credit",
});

const connection = (
	id: string,
	status: CdrConnectionStatus = CdrConnectionStatus.Active,
): RedbarkConnection => ({ id, status });

const account = (
	id: string,
	over: Partial<RedbarkAccount> = {},
): RedbarkAccount => ({
	id,
	connection: "conn_1",
	name: `Name ${id}`,
	status: "available",
	...over,
});

const savedState = (
	accountId: string,
	over: Partial<CdrSyncState> = {},
): CdrSyncState => ({
	id: 1,
	accountId,
	accountName: null,
	connectionId: "conn_1",
	connectionStatus: CdrConnectionStatus.Active,
	createdAt: NOW,
	highWaterMark: null,
	lastError: null,
	lastSyncedAt: null,
	updatedAt: null,
	...over,
});

interface HarnessOptions {
	connections?: RedbarkConnection[];
	accounts?: RedbarkAccount[];
	saved?: CdrSyncState[];
	rows?: Record<string, RedbarkTransaction[]>;
	listConnections?: () => Promise<RedbarkConnection[]>;
	listTransactions?: (accountId: string) => Promise<RedbarkTransaction[]>;
	upsertSynced?: (rows: SyncedTransaction[]) => Promise<void>;
	redbark?: null;
}

// Fakes are object literals against the interfaces. `calls` keeps the cross-port
// order so a test can assert what happened before what.
function harness(opts: HarnessOptions = {}) {
	const calls: string[] = [];
	const states = new Map<string, CdrSyncState>(
		(opts.saved ?? []).map((s) => [s.accountId, s]),
	);
	const fetches: { accountId: string; from: Date }[] = [];
	const upserts: SyncedTransaction[][] = [];
	const advances: { accountId: string; mark: Date; syncedAt: Date }[] = [];
	const errors: { accountId: string; message: string }[] = [];
	const statusSets: { connectionId: string; status: CdrConnectionStatus }[] =
		[];
	const logs: LogEntry[] = [];

	const repository: CdrRepository = {
		listSyncState: async () => [...states.values()],
		findSyncState: async (accountId) => states.get(accountId),
		upsertAccount: async (a) => {
			calls.push(`upsertAccount ${a.accountId}`);
			states.set(a.accountId, {
				...(states.get(a.accountId) ?? savedState(a.accountId)),
				...a,
			});
		},
		advanceHighWaterMark: async (accountId, mark, syncedAt) => {
			calls.push(`advance ${accountId}`);
			advances.push({ accountId, mark, syncedAt });
		},
		setConnectionStatus: async (connectionId, status) => {
			calls.push(`setConnectionStatus ${connectionId}`);
			statusSets.push({ connectionId, status });
			for (const [id, s] of states)
				if (s.connectionId === connectionId)
					states.set(id, { ...s, connectionStatus: status });
		},
		recordError: async (accountId, message) => {
			calls.push(`recordError ${accountId}`);
			errors.push({ accountId, message });
		},
	};
	const redbark: RedbarkClient = {
		listConnections:
			opts.listConnections ??
			(async () => opts.connections ?? [connection("conn_1")]),
		listAccounts: async () => opts.accounts ?? [account("acct_1")],
		listTransactions: async ({ accountId, from }) => {
			calls.push(`fetch ${accountId}`);
			fetches.push({ accountId, from });
			return opts.listTransactions
				? opts.listTransactions(accountId)
				: (opts.rows?.[accountId] ?? []);
		},
		getAccountBalance: async () => {
			throw new Error("unused in Phase 4");
		},
	};
	const transactions = {
		upsertSynced: async (rows: SyncedTransaction[]) => {
			calls.push("upsertSynced");
			upserts.push(rows);
			await opts.upsertSynced?.(rows);
		},
	};
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};
	const service = new CdrSyncService({
		repository,
		redbark: opts.redbark === null ? null : redbark,
		transactions,
		logger,
	});
	return {
		service,
		calls,
		fetches,
		upserts,
		advances,
		errors,
		statusSets,
		logs,
	};
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected a rejection");
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("CdrSyncService.run", () => {
	describe("window", () => {
		it("backfills 90 days when the account has no mark", async () => {
			const h = harness();

			await h.service.run();

			expect(h.fetches).toEqual([
				{ accountId: "acct_1", from: daysBefore(NOW, 90) },
			]);
		});

		it("fetches from the mark minus the 14-day overlap", async () => {
			const mark = new Date("2026-10-10T00:00:00.000Z");
			const h = harness({
				saved: [savedState("acct_1", { highWaterMark: mark })],
			});

			await h.service.run();

			expect(h.fetches[0]?.from).toEqual(daysBefore(mark, 14));
		});
	});

	describe("ingest", () => {
		it("maps every fetched row and upserts them", async () => {
			const h = harness({
				rows: {
					acct_1: [
						row("t1", "2026-10-01", -4250),
						row("t2", "2026-10-02", 250000),
					],
				},
			});

			await h.service.run();

			expect(h.upserts).toEqual([
				[
					{
						provenance: Provenance.Cdr,
						externalId: "t1",
						accountName: "Name acct_1",
						amount: 42.5,
						date: new Date("2026-10-01T00:00:00.000Z"),
						description: "row t1",
					},
					{
						provenance: Provenance.Cdr,
						externalId: "t2",
						accountName: "Name acct_1",
						amount: -2500,
						date: new Date("2026-10-02T00:00:00.000Z"),
						description: "row t2",
					},
				],
			]);
		});

		it("upserts before it advances the mark, to the newest row's date", async () => {
			const h = harness({
				rows: { acct_1: [row("t1", "2026-10-01"), row("t2", "2026-10-05")] },
			});

			await h.service.run();

			expect(h.calls.indexOf("upsertSynced")).toBeLessThan(
				h.calls.indexOf("advance acct_1"),
			);
			expect(h.advances).toEqual([
				{
					accountId: "acct_1",
					mark: new Date("2026-10-05T00:00:00.000Z"),
					syncedAt: NOW,
				},
			]);
		});

		it("leaves the mark alone when the upsert throws", async () => {
			const h = harness({
				rows: { acct_1: [row("t1", "2026-10-01")] },
				upsertSynced: async () => {
					throw new Error("db down");
				},
			});

			await expect(h.service.run()).rejects.toBeInstanceOf(CdrSyncError);

			expect(h.advances).toEqual([]);
		});

		it("caps a future-dated row at now so the monotonic mark isn't stuck", async () => {
			const h = harness({ rows: { acct_1: [row("t1", "2027-01-01")] } });

			await h.service.run();

			expect(h.advances[0]?.mark).toEqual(NOW);
		});

		it("keeps the current mark when no rows arrive", async () => {
			const mark = new Date("2026-10-10T00:00:00.000Z");
			const h = harness({
				saved: [savedState("acct_1", { highWaterMark: mark })],
			});

			await h.service.run();

			expect(h.advances[0]?.mark).toEqual(mark);
		});

		it("starts the mark at the window start when a first run finds no rows", async () => {
			const h = harness();

			await h.service.run();

			expect(h.advances[0]?.mark).toEqual(daysBefore(NOW, 90));
		});
	});

	describe("discovery", () => {
		it("saves each account with its connection's status, then every connection's status", async () => {
			const h = harness({
				connections: [connection("conn_1", CdrConnectionStatus.Expiring)],
			});

			await h.service.run();

			expect(h.calls.slice(0, 2)).toEqual([
				"upsertAccount acct_1",
				"setConnectionStatus conn_1",
			]);
			expect(h.statusSets).toEqual([
				{ connectionId: "conn_1", status: CdrConnectionStatus.Expiring },
			]);
		});

		it("wraps a retryable discovery failure with its wait and fetches nothing", async () => {
			const h = harness({
				listConnections: async () => {
					throw new RedbarkRetryableError("429", { retryAfterMs: 30_000 });
				},
			});

			const error = await caught(h.service.run());

			expect(error).toBeInstanceOf(CdrSyncError);
			expect(error).toMatchObject({ retryable: true, retryAfterMs: 30_000 });
			expect(h.fetches).toEqual([]);
		});

		it("wraps any other discovery failure as not retryable", async () => {
			const cause = new Error("bad parse");
			const h = harness({
				listConnections: async () => {
					throw cause;
				},
			});

			const error = await caught(h.service.run());

			expect(error).toMatchObject({
				retryable: false,
				retryAfterMs: null,
				cause,
			});
		});
	});

	describe("consent", () => {
		it.each([
			CdrConnectionStatus.Revoked,
			CdrConnectionStatus.Expired,
			CdrConnectionStatus.Invalidated,
		])(
			"skips a %s connection's accounts with a warning and no error",
			async (status) => {
				const h = harness({ connections: [connection("conn_1", status)] });

				await expect(h.service.run()).resolves.toBeUndefined();

				expect(h.fetches).toEqual([]);
				expect(h.errors).toEqual([]);
				expect(h.logs.some((l) => l.level === "warn")).toBe(true);
			},
		);

		it("skips a pending connection quietly", async () => {
			const h = harness({
				connections: [connection("conn_1", CdrConnectionStatus.Pending)],
			});

			await h.service.run();

			expect(h.fetches).toEqual([]);
			expect(h.errors).toEqual([]);
		});

		it("warns on an expiring connection and syncs it", async () => {
			const h = harness({
				connections: [connection("conn_1", CdrConnectionStatus.Expiring)],
			});

			await h.service.run();

			expect(h.fetches).toHaveLength(1);
			expect(h.logs.some((l) => l.level === "warn")).toBe(true);
		});

		it("marks a saved row revoked, with no error and no fetch, when its dead bank no longer lists the account", async () => {
			const h = harness({
				connections: [connection("conn_1", CdrConnectionStatus.Revoked)],
				accounts: [],
				saved: [savedState("acct_old")],
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.statusSets).toEqual([
				{ connectionId: "conn_1", status: CdrConnectionStatus.Revoked },
			]);
			expect(h.fetches).toEqual([]);
			expect(h.errors).toEqual([]);
		});
	});

	describe("account status", () => {
		it("skips a syncing account with no fetch and no error", async () => {
			const h = harness({
				accounts: [account("acct_1", { status: "syncing" })],
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.fetches).toEqual([]);
			expect(h.errors).toEqual([]);
			expect(
				h.logs.some(
					(l) => l.level === "info" && l.attrs.accountId === "acct_1",
				),
			).toBe(true);
		});

		it("records an unavailable account without failing the run", async () => {
			const h = harness({
				accounts: [account("acct_1", { status: "unavailable" })],
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.fetches).toEqual([]);
			expect(h.errors).toEqual([
				{ accountId: "acct_1", message: "unavailable in RedBark" },
			]);
		});
	});

	describe("failures", () => {
		it("lets the other accounts sync, records the error, then throws", async () => {
			const h = harness({
				accounts: [account("acct_bad"), account("acct_ok")],
				rows: { acct_ok: [row("t1", "2026-10-01")] },
				listTransactions: async (accountId) => {
					if (accountId === "acct_bad") throw new Error("boom");
					return [row("t1", "2026-10-01")];
				},
			});

			const error = await caught(h.service.run());

			expect(h.errors).toEqual([{ accountId: "acct_bad", message: "boom" }]);
			expect(h.advances.map((a) => a.accountId)).toEqual(["acct_ok"]);
			expect(h.logs.some((l) => l.level === "error")).toBe(true);
			expect(error).toBeInstanceOf(CdrSyncError);
			expect((error as Error).message).toContain("acct_bad");
		});

		it("reports the longest Retry-After among failed accounts", async () => {
			const waits: Record<string, number> = { a: 30_000, b: 90_000 };
			const h = harness({
				accounts: [account("a"), account("b")],
				listTransactions: async (accountId) => {
					throw new RedbarkRetryableError("429", {
						retryAfterMs: waits[accountId] ?? null,
					});
				},
			});

			const error = await caught(h.service.run());

			expect(error).toMatchObject({ retryable: true, retryAfterMs: 90_000 });
		});

		it("is not retryable when only a mapping throw failed", async () => {
			const h = harness({
				rows: {
					acct_1: [
						{
							...row("t1", "2026-10-01"),
							amount: { amount: 1, currency: "usd" },
						},
					],
				},
			});

			const error = await caught(h.service.run());

			expect(error).toMatchObject({ retryable: false, retryAfterMs: null });
		});

		it("is retryable when any failure was a RedbarkRetryableError", async () => {
			const h = harness({
				accounts: [account("a"), account("b")],
				listTransactions: async (accountId) => {
					if (accountId === "a") throw new Error("mapping");
					throw new RedbarkRetryableError("503");
				},
			});

			const error = await caught(h.service.run());

			expect(error).toMatchObject({ retryable: true, retryAfterMs: null });
			expect((error as CdrSyncError).cause).toBeInstanceOf(Error);
		});

		it("fails a saved account RedBark didn't return, and still syncs the others", async () => {
			const h = harness({
				accounts: [account("acct_1")],
				saved: [savedState("acct_typo", { id: 2, connectionId: null })],
			});

			const error = await caught(h.service.run());

			expect(h.errors).toEqual([
				{ accountId: "acct_typo", message: "not in RedBark" },
			]);
			expect(
				h.logs.some(
					(l) => l.level === "error" && JSON.stringify(l).includes("acct_typo"),
				),
			).toBe(true);
			expect(h.fetches.map((f) => f.accountId)).toEqual(["acct_1"]);
			expect(error).toMatchObject({ retryable: false, retryAfterMs: null });
		});
	});

	describe("no key", () => {
		it("logs and makes no calls", async () => {
			const h = harness({ redbark: null });

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.calls).toEqual([]);
			expect(h.logs.map((l) => l.level)).toEqual(["info"]);
		});
	});
});
