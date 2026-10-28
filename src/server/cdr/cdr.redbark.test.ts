import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HttpRedbarkClient,
	REDBARK_VERSION,
	RedbarkRetryableError,
} from "./cdr.redbark";

const BASE = "https://api.redbark.test";
const client = () =>
	new HttpRedbarkClient({ apiKey: "rbk_test_key", baseUrl: `${BASE}/` });

const json = (
	body: unknown,
	init: { status?: number; headers?: Record<string, string> } = {},
) =>
	new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: init.headers,
	});

const page = (data: unknown[], next: string | null = null) =>
	json({ object: "list", data, next_page_url: next, previous_page_url: null });

const txn = (id: string) => ({
	id,
	account: "acct_1",
	date: "2026-10-01",
	description: "X",
	amount: { amount: -100, currency: "aud" },
	direction: "debit",
	status: "posted",
});

const fetchMock = vi.fn();
const calledUrl = (n = 0) => new URL(fetchMock.mock.calls[n]?.[0] as string);

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("HttpRedbarkClient requests", () => {
	it("sends the bearer key and pinned version, under a timeout", async () => {
		fetchMock.mockResolvedValue(page([]));

		await client().listConnections();

		expect(fetchMock).toHaveBeenCalledWith(
			`${BASE}/v2/connections?limit=100`,
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer rbk_test_key",
					"Redbark-Version": REDBARK_VERSION,
				}),
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("lists accounts and connections from the page data", async () => {
		fetchMock
			.mockResolvedValueOnce(
				page([{ id: "conn_1", status: "active", provider: "fiskil" }]),
			)
			.mockResolvedValueOnce(
				page([
					{
						id: "acct_1",
						connection: "conn_1",
						name: "Everyday",
						type: "transaction",
						status: "available",
						institution: { id: "inst_fk_cba", name: "CommBank", logo: null },
						account_number: "xxxx8273",
					},
				]),
			);
		const c = client();

		await expect(c.listConnections()).resolves.toEqual([
			{ id: "conn_1", status: "active" },
		]);
		await expect(c.listAccounts()).resolves.toEqual([
			{
				id: "acct_1",
				connection: "conn_1",
				name: "Everyday",
				type: "transaction",
				status: "available",
				institution: { name: "CommBank" },
				account_number: "xxxx8273",
			},
		]);
		expect(calledUrl(1).pathname).toBe("/v2/accounts");
	});

	it("reads every account's balance in one call, in the order asked", async () => {
		const fresh = {
			account: "acct_1",
			current: { amount: 123456, currency: "aud" },
			freshness: "fresh",
			observed_at: "2026-10-15T01:00:00Z",
		};
		// One bank that can't answer comes back empty; it doesn't fail the call.
		const unreachable = {
			account: "acct_2",
			current: null,
			freshness: "unavailable",
			observed_at: null,
			retry_after_seconds: 900,
		};
		fetchMock.mockResolvedValue(page([fresh, unreachable]));

		const { retry_after_seconds: _, ...unreachableParsed } = unreachable;

		await expect(client().listBalances(["acct_1", "acct_2"])).resolves.toEqual([
			fresh,
			unreachableParsed,
		]);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(calledUrl().pathname).toBe("/v2/balances");
		expect(calledUrl().searchParams.getAll("account")).toEqual([
			"acct_1",
			"acct_2",
		]);
	});
});

describe("HttpRedbarkClient.listTransactions", () => {
	const from = new Date("2026-09-01T00:00:00.000Z");

	// adr017 facet 3: settled only, so a re-sync never sees a row change amount.
	it("asks for settled rows of one account since `from`", async () => {
		fetchMock.mockResolvedValue(page([]));

		await client().listTransactions({ accountId: "acct_1", from });

		const url = calledUrl();
		expect(url.pathname).toBe("/v2/transactions");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			account: "acct_1",
			from: "2026-09-01",
			include_pending: "false",
			limit: "100",
		});
	});

	// RedBark's `to` is inclusive and, like `from`, a bare day in the member's zone.
	it("sends `to` as a bare day when given", async () => {
		fetchMock.mockResolvedValue(page([]));

		await client().listTransactions({
			accountId: "acct_1",
			from,
			to: new Date("2026-11-29T00:00:00.000Z"),
		});

		expect(calledUrl().searchParams.get("from")).toBe("2026-09-01");
		expect(calledUrl().searchParams.get("to")).toBe("2026-11-29");
	});

	it("follows next_page_url until it is null", async () => {
		fetchMock
			.mockResolvedValueOnce(
				page([txn("t1")], `${BASE}/v2/transactions?page=p2`),
			)
			.mockResolvedValueOnce(
				page([txn("t2")], `${BASE}/v2/transactions?page=p3`),
			)
			.mockResolvedValueOnce(page([txn("t3")]));

		const rows = await client().listTransactions({ accountId: "acct_1", from });

		expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
		expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
			expect.stringContaining("/v2/transactions?"),
			`${BASE}/v2/transactions?page=p2`,
			`${BASE}/v2/transactions?page=p3`,
		]);
	});

	// The key rides on every page request, so a next page off RedBark's origin
	// would hand it to someone else.
	it("refuses a next page on another origin without calling it", async () => {
		fetchMock.mockResolvedValueOnce(
			page([txn("t1")], "https://evil.test/v2/transactions?page=p2"),
		);

		await expect(
			client().listTransactions({ accountId: "acct_1", from }),
		).rejects.toThrow(/origin/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// RedBark caps a window at 5,000 rows; missing rows would never come back.
	it("throws when RedBark truncates the window", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ data: [], next_page_url: null }), {
				headers: { "X-Redbark-Truncated": "true" },
			}),
		);

		await expect(
			client().listTransactions({ accountId: "acct_1", from }),
		).rejects.toThrow(/truncated/);
	});
});

describe("HttpRedbarkClient failures", () => {
	const fail = (status: number, headers: Record<string, string> = {}) =>
		json(
			{ error: { type: "x", code: "some_code", message: "nope" } },
			{ status, headers },
		);

	const rejection = async () => {
		const error = await client()
			.listConnections()
			.catch((e: unknown) => e);
		return error as Error;
	};

	it("turns a 429 with delta-seconds Retry-After into a retryable wait", async () => {
		fetchMock.mockResolvedValue(fail(429, { "Retry-After": "30" }));

		const error = await rejection();

		expect(error).toBeInstanceOf(RedbarkRetryableError);
		expect((error as RedbarkRetryableError).retryAfterMs).toBe(30_000);
	});

	it("reads an HTTP-date Retry-After as the ms until that date", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
		fetchMock.mockResolvedValue(
			fail(429, { "Retry-After": "Thu, 15 Oct 2026 00:02:00 GMT" }),
		);

		expect(((await rejection()) as RedbarkRetryableError).retryAfterMs).toBe(
			120_000,
		);
	});

	it.each([
		["missing", {}],
		["garbage", { "Retry-After": "soon" }],
		["in the past", { "Retry-After": "Thu, 01 Jan 2026 00:00:00 GMT" }],
	])("gives no wait when Retry-After is %s", async (_, headers) => {
		fetchMock.mockResolvedValue(fail(429, headers));

		const error = await rejection();

		expect(error).toBeInstanceOf(RedbarkRetryableError);
		expect((error as RedbarkRetryableError).retryAfterMs).toBeNull();
	});

	it("treats a 5xx as retryable", async () => {
		fetchMock.mockResolvedValue(fail(503));

		expect(await rejection()).toBeInstanceOf(RedbarkRetryableError);
	});

	it("treats a network failure as retryable, keeping the cause", async () => {
		const cause = new TypeError("fetch failed");
		fetchMock.mockRejectedValue(cause);

		const error = await rejection();

		expect(error).toBeInstanceOf(RedbarkRetryableError);
		expect(error.cause).toBe(cause);
	});

	it("treats a body cut off mid-read as retryable, keeping the cause", async () => {
		const cause = new TypeError("terminated");
		const response = new Response("{}");
		vi.spyOn(response, "json").mockRejectedValue(cause);
		fetchMock.mockResolvedValue(response);

		const error = await rejection();

		expect(error).toBeInstanceOf(RedbarkRetryableError);
		expect(error.cause).toBe(cause);
	});

	it("throws a plain error on a body that isn't JSON", async () => {
		fetchMock.mockResolvedValue(new Response("<html>"));

		const error = await rejection();

		expect(error).toBeInstanceOf(SyntaxError);
	});

	it("throws a plain error naming RedBark's code on a 400", async () => {
		fetchMock.mockResolvedValue(fail(400));

		const error = await rejection();

		expect(error).not.toBeInstanceOf(RedbarkRetryableError);
		expect(error.message).toMatch(/400 some_code/);
	});

	it("never puts the key in an error message", async () => {
		fetchMock.mockResolvedValue(fail(401));

		expect((await rejection()).message).not.toContain("rbk_test_key");
	});

	it("throws a plain error on a body that doesn't match the contract", async () => {
		fetchMock.mockResolvedValue(page([{ id: "conn_1", status: "paused" }]));

		expect(await rejection()).not.toBeInstanceOf(RedbarkRetryableError);
	});
});
