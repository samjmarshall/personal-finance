import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSetInput } from "~/domain/balances";
import type {
	CdrImport,
	CdrSyncState,
	RedbarkAccount,
	RedbarkBalance,
	RedbarkConnection,
	RedbarkTransaction,
} from "~/domain/cdr";
import type { SyncedTransaction } from "~/domain/transactions";
import {
	BalanceSource,
	CdrConnectionStatus,
	CdrImportStatus,
	Provenance,
} from "~/lib/constants";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { unstaged } from "~/test/fakes";
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
	institution: { name: "CommBank" },
	account_number: "xxxx8273",
	type: "transaction",
	status: "available",
	...over,
});

const balance = (
	account: string,
	over: Partial<RedbarkBalance> = {},
): RedbarkBalance => ({
	account,
	current: { amount: 100_00, currency: "aud" },
	freshness: "fresh",
	observed_at: "2026-10-19T20:00:00Z",
	...over,
});

const savedState = (
	accountId: string,
	over: Partial<CdrSyncState> = {},
): CdrSyncState => ({
	id: 1,
	accountId,
	accountName: null,
	accountNumber: null,
	balance: null,
	balanceAsOf: null,
	connectionId: "conn_1",
	connectionStatus: CdrConnectionStatus.Active,
	createdAt: NOW,
	highWaterMark: null,
	inBalance: null,
	institutionName: null,
	lastError: null,
	lastSyncedAt: null,
	nickname: null,
	updatedAt: null,
	...over,
});

interface HarnessOptions {
	connections?: RedbarkConnection[];
	accounts?: RedbarkAccount[];
	saved?: CdrSyncState[];
	rows?: Record<string, RedbarkTransaction[]>;
	listConnections?: () => Promise<RedbarkConnection[]>;
	listSyncState?: () => Promise<CdrSyncState[]>;
	listTransactions?: (accountId: string) => Promise<RedbarkTransaction[]>;
	reconcileSynced?: (rows: SyncedTransaction[]) => Promise<void>;
	recordError?: (accountId: string) => Promise<void>;
	balances?: Record<string, RedbarkBalance>;
	listBalances?: (accountIds: string[]) => Promise<RedbarkBalance[]>;
	recordSynced?: (input: BalanceSetInput) => Promise<void>;
	redbark?: null;
	/** Result of claiming a queued import; none if already past queued. */
	runningImport?: CdrImport | undefined;
}

const IMPORT_ROW_RANGE = { from: "2026-01-01", to: "2026-04-01" };

const importRow = (over: Partial<CdrImport> = {}): CdrImport => ({
	id: 7,
	fromDate: new Date("2026-01-01T00:00:00.000Z"),
	toDate: new Date("2026-04-01T00:00:00.000Z"),
	status: CdrImportStatus.Running,
	added: 0,
	adopted: 0,
	flagged: 0,
	known: 0,
	error: null,
	createdAt: NOW,
	finishedAt: null,
	...over,
});

// Records call order across ports so a test can assert what ran before what.
function harness(opts: HarnessOptions = {}) {
	const calls: string[] = [];
	const states = new Map<string, CdrSyncState>(
		(opts.saved ?? []).map((s) => [s.accountId, s]),
	);
	const fetches: { accountId: string; from: Date; to?: Date }[] = [];
	const reconciles: {
		rows: SyncedTransaction[];
		liveAccountIds: string[];
	}[] = [];
	const advances: { accountId: string; mark: Date; syncedAt: Date }[] = [];
	const errors: { accountId: string; message: string }[] = [];
	const statusSets: { connectionId: string; status: CdrConnectionStatus }[] =
		[];
	const balanceReads: string[][] = [];
	const savedBalances: ({ accountId: string } & BalanceSetInput)[] = [];
	const anchors: BalanceSetInput[] = [];
	const logs: LogEntry[] = [];
	const importCounts: { id: number; counts: unknown }[] = [];
	const importEnds: { id: number; failed?: string }[] = [];

	const repository: CdrRepository = {
		listSyncState: opts.listSyncState ?? (async () => [...states.values()]),
		upsertAccount: async (a) => {
			calls.push(`upsertAccount ${a.accountId}`);
			const prev = states.get(a.accountId) ?? savedState(a.accountId);
			// Mirrors the SQL coalesce: a saved flag wins over discovery's default.
			states.set(a.accountId, {
				...prev,
				...a,
				inBalance: prev.inBalance ?? a.inBalance,
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
			await opts.recordError?.(accountId);
		},
		recordBalance: async (accountId, latest) => {
			calls.push(`recordBalance ${accountId}`);
			savedBalances.push({ accountId, ...latest });
		},
		// A member's choices; the sync never writes them.
		setInBalance: unstaged,
		setNickname: unstaged,
		// The page starts and reads imports; the worker only moves them.
		insertImport: unstaged,
		findActiveImport: unstaged,
		latestImport: unstaged,
		markImportRunning: async (id) => {
			calls.push(`markImportRunning ${id}`);
			return "runningImport" in opts ? opts.runningImport : importRow({ id });
		},
		addImportCounts: async (id, counts) => {
			calls.push(`addImportCounts ${id}`);
			importCounts.push({ id, counts });
		},
		finishImport: async (id) => {
			calls.push(`finishImport ${id}`);
			importEnds.push({ id });
		},
		failImport: async (id, message) => {
			calls.push(`failImport ${id}`);
			importEnds.push({ id, failed: message });
		},
	};
	const redbark: RedbarkClient = {
		listConnections: async () =>
			opts.listConnections
				? opts.listConnections()
				: (opts.connections ?? [connection("conn_1")]),
		listAccounts: async () => opts.accounts ?? [account("acct_1")],
		listTransactions: async ({ accountId, from, to }) => {
			calls.push(`fetch ${accountId}`);
			fetches.push({ accountId, from, to });
			return opts.listTransactions
				? opts.listTransactions(accountId)
				: (opts.rows?.[accountId] ?? []);
		},
		listBalances: async (accountIds) => {
			calls.push("listBalances");
			balanceReads.push(accountIds);
			return opts.listBalances
				? opts.listBalances(accountIds)
				: accountIds.map((id) => opts.balances?.[id] ?? balance(id));
		},
	};
	const transactions = {
		reconcileSynced: async (
			rows: SyncedTransaction[],
			{ liveAccountIds }: { liveAccountIds: string[] },
		) => {
			calls.push("reconcileSynced");
			reconciles.push({ rows, liveAccountIds });
			await opts.reconcileSynced?.(rows);
			return { added: rows.length, adopted: 0, flagged: 0, known: 0 };
		},
	};
	const balances = {
		recordSynced: async (input: BalanceSetInput) => {
			calls.push("recordSynced");
			await opts.recordSynced?.(input);
			anchors.push(input);
			return { ...input, id: 1, createdAt: NOW, source: BalanceSource.Cdr };
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
		balances,
		logger,
	});
	return {
		service,
		calls,
		states,
		fetches,
		reconciles,
		advances,
		errors,
		statusSets,
		balanceReads,
		savedBalances,
		anchors,
		logs,
		importCounts,
		importEnds,
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
		it("fetches only the last 14 days when the account has no mark", async () => {
			const h = harness();

			await h.service.run();

			expect(h.fetches).toEqual([
				{ accountId: "acct_1", from: daysBefore(NOW, 14) },
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
		it("maps every fetched row and reconciles them", async () => {
			const h = harness({
				rows: {
					acct_1: [
						row("t1", "2026-10-01", -4250),
						row("t2", "2026-10-02", 250000),
					],
				},
			});

			await h.service.run();

			expect(h.reconciles.map(({ rows }) => rows)).toEqual([
				[
					{
						provenance: Provenance.Cdr,
						externalId: "t1",
						externalAccountId: "acct_1",
						accountName: "Name acct_1",
						amount: 42.5,
						date: new Date("2026-10-01T00:00:00.000Z"),
						description: "row t1",
					},
					{
						provenance: Provenance.Cdr,
						externalId: "t2",
						externalAccountId: "acct_1",
						accountName: "Name acct_1",
						amount: -2500,
						date: new Date("2026-10-02T00:00:00.000Z"),
						description: "row t2",
					},
				],
			]);
		});

		// A bank row from an account RedBark still lists is never a match candidate.
		it("tells the reconcile every account RedBark listed, synced or not", async () => {
			const h = harness({
				accounts: [account("acct_1"), account("acct_2", { status: "syncing" })],
			});

			await h.service.run();

			expect(h.reconciles.map(({ liveAccountIds }) => liveAccountIds)).toEqual([
				["acct_1", "acct_2"],
			]);
		});

		it("reconciles before it advances the mark, to the newest row's date", async () => {
			const h = harness({
				rows: { acct_1: [row("t1", "2026-10-01"), row("t2", "2026-10-05")] },
			});

			await h.service.run();

			expect(h.calls.indexOf("reconcileSynced")).toBeLessThan(
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

		it("leaves the mark alone when the reconcile throws", async () => {
			const h = harness({
				rows: { acct_1: [row("t1", "2026-10-01")] },
				reconcileSynced: async () => {
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

			expect(h.advances[0]?.mark).toEqual(daysBefore(NOW, 14));
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

	it("fails a sync state read without a retry, and fetches nothing", async () => {
		const cause = new Error("connection terminated");
		const h = harness({
			listSyncState: async () => {
				throw cause;
			},
		});

		const error = await caught(h.service.run());

		expect(error).toBeInstanceOf(CdrSyncError);
		expect(error).toMatchObject({ retryable: false, cause });
		expect(h.fetches).toEqual([]);
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

		it("saves an account on a connection RedBark doesn't list as pending, and skips it", async () => {
			const h = harness({
				connections: [],
				accounts: [account("acct_1", { connection: "conn_unlisted" })],
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.states.get("acct_1")?.connectionStatus).toBe(
				CdrConnectionStatus.Pending,
			);
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

		it("keeps going when saving an account's error fails", async () => {
			const h = harness({
				accounts: [account("acct_bad"), account("acct_ok")],
				listTransactions: async (accountId) => {
					if (accountId === "acct_bad") throw new RedbarkRetryableError("503");
					return [row("t1", "2026-10-01")];
				},
				recordError: async () => {
					throw new Error("db blip");
				},
			});

			const error = await caught(h.service.run());

			expect(h.advances.map((a) => a.accountId)).toEqual(["acct_ok"]);
			expect(error).toBeInstanceOf(CdrSyncError);
			expect(error).toMatchObject({ retryable: true });
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

	describe("balance anchor", () => {
		const OLDEST = "2026-10-19T19:00:00Z";

		it("saves each account's default flag from its type", async () => {
			const h = harness({
				accounts: [
					account("acct_tx"),
					account("acct_card", { type: "credit-card" }),
					account("acct_loan", { type: "loan" }),
					account("acct_td", { type: "term-deposit" }),
				],
			});

			await h.service.run();

			expect(
				Object.fromEntries(
					[...h.states.values()].map((s) => [s.accountId, s.inBalance]),
				),
			).toEqual({
				acct_tx: true,
				acct_card: true,
				acct_loan: false,
				acct_td: null,
			});
		});

		it("writes one anchor summing only counted accounts, a card lowering it", async () => {
			const h = harness({
				accounts: [
					account("acct_tx"),
					account("acct_card", { type: "credit-card" }),
					account("acct_loan", { type: "loan" }),
				],
				balances: {
					acct_tx: balance("acct_tx", {
						current: { amount: 1_000_00, currency: "aud" },
						observed_at: OLDEST,
					}),
					acct_card: balance("acct_card", {
						current: { amount: -300_00, currency: "aud" },
					}),
					acct_loan: balance("acct_loan", {
						current: { amount: -50_000_00, currency: "aud" },
					}),
				},
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.anchors).toEqual([{ amount: 700, asOf: new Date(OLDEST) }]);
		});

		it("never lets a left-out account block it, even one pending or unavailable", async () => {
			const h = harness({
				connections: [
					connection("conn_1"),
					connection("conn_2", CdrConnectionStatus.Pending),
				],
				accounts: [
					account("acct_tx"),
					account("acct_loan", { type: "loan", connection: "conn_2" }),
					account("acct_old", { type: "loan", status: "unavailable" }),
				],
			});

			await h.service.run();

			expect(h.anchors).toHaveLength(1);
		});

		it("keeps a card the member set to false out of the sum", async () => {
			const h = harness({
				accounts: [
					account("acct_tx"),
					account("acct_card", { type: "credit-card" }),
				],
				saved: [savedState("acct_card", { id: 2, inBalance: false })],
			});

			await h.service.run();

			expect(h.states.get("acct_card")?.inBalance).toBe(false);
			expect(h.anchors).toEqual([
				{ amount: 100, asOf: new Date("2026-10-19T20:00:00Z") },
			]);
		});

		it("skips the anchor while any account is undecided, warning with its type", async () => {
			const h = harness({
				accounts: [
					account("acct_tx"),
					account("acct_td", { type: "term-deposit" }),
				],
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.anchors).toEqual([]);
			expect(h.logs).toContainEqual({
				level: "warn",
				msg: expect.any(String),
				attrs: { accountId: "acct_td", type: "term-deposit" },
			});
			expect(
				h.logs.some((l) => l.level === "info" && /anchor/.test(l.msg)),
			).toBe(true);
		});

		it("skips the anchor when no account counts", async () => {
			const h = harness({ accounts: [account("acct_loan", { type: "loan" })] });

			await h.service.run();

			expect(h.anchors).toEqual([]);
		});

		it("skips the anchor when a counted balance is stale", async () => {
			const h = harness({
				balances: { acct_1: balance("acct_1", { freshness: "stale" }) },
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.anchors).toEqual([]);
			expect(
				h.logs.some((l) => l.level === "info" && /anchor/.test(l.msg)),
			).toBe(true);
		});

		it.each([
			CdrConnectionStatus.Revoked,
			CdrConnectionStatus.Expired,
			CdrConnectionStatus.Invalidated,
			CdrConnectionStatus.Pending,
		])(
			"skips the anchor when a counted account's consent is %s",
			async (status) => {
				const h = harness({
					connections: [connection("conn_1"), connection("conn_2", status)],
					accounts: [
						account("acct_1"),
						account("acct_2", { connection: "conn_2" }),
					],
				});

				await h.service.run();

				expect(h.anchors).toEqual([]);
			},
		);

		it.each(["syncing", "unavailable"] as const)(
			"skips the anchor when a counted account is %s",
			async (status) => {
				const h = harness({
					accounts: [account("acct_1"), account("acct_2", { status })],
				});

				await h.service.run();

				expect(h.anchors).toEqual([]);
			},
		);

		it("skips the anchor when a counted account failed", async () => {
			const h = harness({
				accounts: [account("acct_1"), account("acct_2")],
				listTransactions: async (accountId) => {
					if (accountId === "acct_2") throw new Error("boom");
					return [];
				},
			});

			await expect(h.service.run()).rejects.toBeInstanceOf(CdrSyncError);

			expect(h.anchors).toEqual([]);
		});

		// A loan's rows breaking the sign check daily must not hold the cash line for good.
		it("writes the anchor when only a left-out account failed, then throws", async () => {
			const h = harness({
				accounts: [account("acct_1"), account("acct_loan", { type: "loan" })],
				listTransactions: async (accountId) => {
					if (accountId === "acct_loan") throw new Error("boom");
					return [];
				},
			});

			await expect(h.service.run()).rejects.toBeInstanceOf(CdrSyncError);

			expect(h.anchors).toHaveLength(1);
		});

		it.each([
			[
				"a balance is not AUD",
				{
					balances: {
						acct_1: balance("acct_1", {
							current: { amount: 100, currency: "usd" },
						}),
					},
				},
			],
			[
				"saving the anchor throws",
				{
					recordSynced: async () => {
						throw new Error("db down");
					},
				},
			],
		] satisfies [string, HarnessOptions][])(
			"logs an error and resolves when %s",
			async (_, opts) => {
				const h = harness(opts);

				await expect(h.service.run()).resolves.toBeUndefined();

				expect(h.anchors).toEqual([]);
				expect(
					h.logs.some((l) => l.level === "error" && /anchor/.test(l.msg)),
				).toBe(true);
			},
		);
	});

	describe("account balances", () => {
		it("saves each account's bank name and masked number", async () => {
			const h = harness();

			await h.service.run();

			expect(h.states.get("acct_1")).toMatchObject({
				institutionName: "CommBank",
				accountNumber: "xxxx8273",
			});
		});

		it("reads every account on a live connection in one call, saving each readable balance", async () => {
			const h = harness({
				connections: [
					connection("conn_1"),
					connection("conn_2", CdrConnectionStatus.Revoked),
				],
				accounts: [
					account("acct_tx"),
					account("acct_loan", { type: "loan" }),
					account("acct_gone"),
					account("acct_old", { connection: "conn_2" }),
				],
				balances: {
					acct_loan: balance("acct_loan", {
						current: { amount: -8_394_25, currency: "aud" },
						freshness: "stale",
					}),
					acct_gone: balance("acct_gone", {
						current: null,
						freshness: "unavailable",
						observed_at: null,
					}),
				},
			});

			await h.service.run();

			expect(h.balanceReads).toEqual([["acct_tx", "acct_loan", "acct_gone"]]);
			expect(h.savedBalances).toEqual([
				{
					accountId: "acct_tx",
					amount: 100,
					asOf: new Date("2026-10-19T20:00:00Z"),
				},
				{
					accountId: "acct_loan",
					amount: -8394.25,
					asOf: new Date("2026-10-19T20:00:00Z"),
				},
			]);
		});

		it("anchors from that same reply with no second read", async () => {
			const h = harness();

			await h.service.run();

			expect(h.balanceReads).toHaveLength(1);
			expect(h.anchors).toEqual([
				{ amount: 100, asOf: new Date("2026-10-19T20:00:00Z") },
			]);
		});

		it("skips the anchor when a counted account is missing from the reply", async () => {
			const h = harness({ listBalances: async () => [] });

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.anchors).toEqual([]);
			expect(
				h.logs.some((l) => l.level === "info" && /anchor/.test(l.msg)),
			).toBe(true);
		});

		it("logs an error and still syncs when the read throws", async () => {
			const h = harness({
				listBalances: async () => {
					throw new RedbarkRetryableError("429");
				},
			});

			await expect(h.service.run()).resolves.toBeUndefined();

			expect(h.advances).toHaveLength(1);
			expect(h.savedBalances).toEqual([]);
			expect(h.anchors).toEqual([]);
			expect(
				h.logs.some((l) => l.level === "error" && /balance/.test(l.msg)),
			).toBe(true);
		});

		it("makes no call when no account is on a live connection", async () => {
			const h = harness({
				connections: [connection("conn_1", CdrConnectionStatus.Pending)],
			});

			await h.service.run();

			expect(h.balanceReads).toEqual([]);
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

describe("CdrSyncService.claimImport", () => {
	it("claims a queued import and returns its day range", async () => {
		const h = harness();

		await expect(h.service.claimImport(7)).resolves.toEqual(IMPORT_ROW_RANGE);
		expect(h.calls).toEqual(["markImportRunning 7"]);
	});

	// The outbox can deliver the event twice; the second must not redo the import.
	it("returns null when the import already finished", async () => {
		const h = harness({ runningImport: undefined });

		await expect(h.service.claimImport(7)).resolves.toBeNull();
		expect(h.importEnds).toEqual([]);
	});
});

describe("CdrSyncService.planImport", () => {
	it("fails the import with a reason and plans nothing when the key is unset", async () => {
		const h = harness({ redbark: null });

		await expect(h.service.planImport(7, IMPORT_ROW_RANGE)).resolves.toEqual({
			liveAccountIds: [],
			chunks: [],
		});
		expect(h.importEnds).toEqual([{ id: 7, failed: "Bank sync isn't set up" }]);
	});

	it("chunks only accounts the daily sync would sync, each with its name", async () => {
		const h = harness({
			connections: [
				connection("conn_1"),
				connection("conn_2", CdrConnectionStatus.Revoked),
				connection("conn_3", CdrConnectionStatus.Pending),
			],
			accounts: [
				account("acct_1"),
				account("acct_2", { status: "syncing" }),
				account("acct_3", { connection: "conn_2" }),
				account("acct_4", { status: "unavailable" }),
				account("acct_5", { connection: "conn_3" }),
				account("acct_6", { connection: "conn_unlisted" }),
			],
		});

		const plan = await h.service.planImport(7, IMPORT_ROW_RANGE);

		expect(plan.liveAccountIds).toEqual([
			"acct_1",
			"acct_2",
			"acct_3",
			"acct_4",
			"acct_5",
			"acct_6",
		]);
		expect(plan.chunks).toEqual([
			{
				accountId: "acct_1",
				accountName: "Name acct_1",
				from: "2026-01-01",
				to: "2026-03-31",
			},
			{
				accountId: "acct_1",
				accountName: "Name acct_1",
				from: "2026-04-01",
				to: "2026-04-01",
			},
		]);
		expect(h.calls).toContain("upsertAccount acct_1");
	});

	// A "Done" with all zeros would hide that nothing was fetched.
	it("fails the import with a reason when no account is ready to import", async () => {
		const h = harness({
			connections: [connection("conn_1", CdrConnectionStatus.Revoked)],
		});

		await expect(h.service.planImport(7, IMPORT_ROW_RANGE)).resolves.toEqual({
			liveAccountIds: [],
			chunks: [],
		});
		expect(h.importEnds).toEqual([
			{
				id: 7,
				failed:
					"No bank account is ready to import. Check Settings → Bank accounts.",
			},
		]);
	});

	it("wraps a discovery failure like the daily sync", async () => {
		const h = harness({
			listConnections: async () => {
				throw new RedbarkRetryableError("429", { retryAfterMs: 30_000 });
			},
		});

		const error = await caught(h.service.planImport(7, IMPORT_ROW_RANGE));

		expect(error).toBeInstanceOf(CdrSyncError);
		expect(error).toMatchObject({ retryable: true, retryAfterMs: 30_000 });
	});

	// Inngest caps a run at 1,000 steps.
	it("fails the import with a reason and plans nothing when the chunks would pass the step cap", async () => {
		const h = harness({
			accounts: Array.from({ length: 35 }, (_, i) => account(`acct_${i}`)),
		});

		await expect(
			h.service.planImport(7, { from: "2019-10-20", to: "2026-10-20" }),
		).resolves.toEqual({
			liveAccountIds: [],
			chunks: [],
		});
		expect(h.importEnds).toEqual([
			{
				id: 7,
				failed: "This import is too big for one run. Try a shorter range.",
			},
		]);
	});
});

describe("CdrSyncService.importChunk", () => {
	const chunk = {
		accountId: "acct_1",
		accountName: "Everyday Offset",
		from: "2026-01-01",
		to: "2026-03-31",
	};

	it("fetches the window, maps with the chunk's name, reconciles with the live ids and adds the counts", async () => {
		const h = harness({
			rows: { acct_1: [row("t1", "2026-02-01"), row("t2", "2026-03-01")] },
		});

		await expect(
			h.service.importChunk(7, chunk, ["acct_1", "acct_9"]),
		).resolves.toEqual({ added: 2, adopted: 0, flagged: 0, known: 0 });

		expect(h.fetches).toEqual([
			{
				accountId: "acct_1",
				from: new Date("2026-01-01T00:00:00.000Z"),
				to: new Date("2026-03-31T00:00:00.000Z"),
			},
		]);
		expect(h.reconciles).toHaveLength(1);
		expect(h.reconciles[0]?.liveAccountIds).toEqual(["acct_1", "acct_9"]);
		expect(h.reconciles[0]?.rows.map((r) => r.accountName)).toEqual([
			"Everyday Offset",
			"Everyday Offset",
		]);
		expect(h.importCounts).toEqual([
			{ id: 7, counts: { added: 2, adopted: 0, flagged: 0, known: 0 } },
		]);
	});

	it("throws a retryable CdrSyncError with RedBark's wait on a 429", async () => {
		const h = harness({
			listTransactions: async () => {
				throw new RedbarkRetryableError("429", { retryAfterMs: 30_000 });
			},
		});

		const error = await caught(h.service.importChunk(7, chunk, ["acct_1"]));

		expect(error).toBeInstanceOf(CdrSyncError);
		expect(error).toMatchObject({ retryable: true, retryAfterMs: 30_000 });
		expect(h.importCounts).toEqual([]);
	});

	it("throws a non-retryable CdrSyncError on a mapping throw", async () => {
		const foreign = {
			...row("t1", "2026-02-01"),
			amount: { amount: -100, currency: "usd" },
		};
		const h = harness({ rows: { acct_1: [foreign] } });

		const error = await caught(h.service.importChunk(7, chunk, ["acct_1"]));

		expect(error).toBeInstanceOf(CdrSyncError);
		expect(error).toMatchObject({ retryable: false });
		expect(h.reconciles).toEqual([]);
	});

	// Only bank errors are sorted into retry or not; a database blip keeps the job's retries.
	it("lets a reconcile error through unwrapped", async () => {
		const blip = new Error("connection terminated");
		const h = harness({
			rows: { acct_1: [row("t1", "2026-02-01")] },
			reconcileSynced: async () => {
				throw blip;
			},
		});

		await expect(h.service.importChunk(7, chunk, ["acct_1"])).rejects.toBe(
			blip,
		);
		expect(h.importCounts).toEqual([]);
	});

	it("never advances a mark, reads balances or writes an anchor", async () => {
		const h = harness({
			saved: [savedState("acct_1", { inBalance: true })],
			rows: { acct_1: [row("t1", "2026-02-01")] },
		});

		const plan = await h.service.planImport(7, IMPORT_ROW_RANGE);
		for (const c of plan.chunks)
			await h.service.importChunk(7, c, plan.liveAccountIds);

		expect(h.reconciles.length).toBeGreaterThan(0);
		expect(h.advances).toEqual([]);
		expect(h.balanceReads).toEqual([]);
		expect(h.anchors).toEqual([]);
	});
});

describe("CdrSyncService.finishImport and failImport", () => {
	it("hands each to the repository; a failure in plain words", async () => {
		const h = harness();

		await h.service.finishImport(7);
		await h.service.failImport(8);

		expect(h.importEnds).toEqual([
			{ id: 7 },
			{ id: 8, failed: "The import stopped on an error. Try again later." },
		]);
	});
});
