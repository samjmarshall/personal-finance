import { z } from "zod";
import {
	type RedbarkAccount,
	type RedbarkBalance,
	type RedbarkConnection,
	type RedbarkTransaction,
	redbarkAccountDto,
	redbarkBalanceDto,
	redbarkConnectionDto,
	redbarkPageDto,
	redbarkTransactionDto,
} from "~/domain/cdr";

/** Pinned in code, not env: a new version can change response shapes. Beta until v2 GA (adr017). */
export const REDBARK_VERSION = "2026-10-01.wattle";

// RedBark's largest page, to spend fewer calls of its 30/min transactions budget.
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 15_000;

/** Read side of RedBark v2 for every bank linked to the account key. */
export interface RedbarkClient {
	listConnections(): Promise<RedbarkConnection[]>;
	listAccounts(): Promise<RedbarkAccount[]>;
	/** Settled rows only, every page. Throws if RedBark truncates the window. */
	listTransactions(query: {
		accountId: string;
		from: Date;
	}): Promise<RedbarkTransaction[]>;
	/** One call for up to 100 accounts. An account RedBark can't read comes back with a null `current`. */
	listBalances(accountIds: string[]): Promise<RedbarkBalance[]>;
}

/** A 429, 5xx or network failure. `retryAfterMs` is null when RedBark gave no usable wait. */
export class RedbarkRetryableError extends Error {
	readonly retryAfterMs: number | null;

	constructor(
		message: string,
		{
			retryAfterMs = null,
			cause,
		}: { retryAfterMs?: number | null; cause?: unknown } = {},
	) {
		super(message, { cause });
		this.name = "RedbarkRetryableError";
		this.retryAfterMs = retryAfterMs;
	}
}

const errorBodyDto = z.object({ error: z.object({ code: z.string() }) });

interface HttpRedbarkClientDeps {
	apiKey: string;
	baseUrl: string;
}

export class HttpRedbarkClient implements RedbarkClient {
	private readonly apiKey: string;
	private readonly apiRoot: string;

	constructor({ apiKey, baseUrl }: HttpRedbarkClientDeps) {
		this.apiKey = apiKey;
		this.apiRoot = `${baseUrl.replace(/\/+$/, "")}/v2`;
	}

	listConnections(): Promise<RedbarkConnection[]> {
		return this.list("/connections", {}, redbarkConnectionDto);
	}

	listAccounts(): Promise<RedbarkAccount[]> {
		return this.list("/accounts", {}, redbarkAccountDto);
	}

	listTransactions({
		accountId,
		from,
	}: {
		accountId: string;
		from: Date;
	}): Promise<RedbarkTransaction[]> {
		return this.list(
			"/transactions",
			{
				account: accountId,
				// A full timestamp is an instant to RedBark (UTC midnight = Sydney mid-morning);
				// a bare date is the whole day in the member's zone, like each row's date.
				from: from.toISOString().slice(0, 10),
				// adr017 facet 3: a pending row can still change amount or vanish.
				include_pending: "false",
			},
			redbarkTransactionDto,
		);
	}

	async listBalances(accountIds: string[]): Promise<RedbarkBalance[]> {
		const query = new URLSearchParams(accountIds.map((id) => ["account", id]));
		const { body } = await this.get(`${this.apiRoot}/balances?${query}`);
		return redbarkPageDto(redbarkBalanceDto).parse(body).data;
	}

	private async list<T extends z.ZodType>(
		path: string,
		params: Record<string, string>,
		item: T,
	): Promise<z.infer<T>[]> {
		const pageDto = redbarkPageDto(item);
		const query = new URLSearchParams({ ...params, limit: String(PAGE_LIMIT) });
		const rows: z.infer<T>[] = [];
		let url: string | null = `${this.apiRoot}${path}?${query}`;
		while (url) {
			const { body, headers } = await this.get(url);
			// Rows past RedBark's cap are dropped, and the cursor would then skip them for good.
			if (headers.get("x-redbark-truncated") === "true")
				throw new Error(`redbark GET ${path}: window truncated`);
			const page = pageDto.parse(body);
			rows.push(...page.data);
			url = page.next_page_url;
			// Every request carries the key, so never follow a link off RedBark's origin.
			if (url && new URL(url).origin !== new URL(this.apiRoot).origin)
				throw new Error(`redbark GET ${path}: next page on another origin`);
		}
		return rows;
	}

	private async get(url: string): Promise<{ body: unknown; headers: Headers }> {
		const path = new URL(url).pathname;
		let response: Response;
		try {
			response = await fetch(url, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					"Redbark-Version": REDBARK_VERSION,
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (cause) {
			throw new RedbarkRetryableError(`redbark GET ${path} failed`, { cause });
		}

		if (!response.ok) {
			const message = `redbark GET ${path} failed: ${response.status} ${await readErrorCode(response)}`;
			if (response.status === 429 || response.status >= 500)
				throw new RedbarkRetryableError(message, {
					retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
				});
			throw new Error(message);
		}
		try {
			return { body: await response.json(), headers: response.headers };
		} catch (cause) {
			// Bad JSON won't heal on retry; a body cut off by a reset or timeout will.
			if (cause instanceof SyntaxError) throw cause;
			throw new RedbarkRetryableError(`redbark GET ${path} failed`, { cause });
		}
	}
}

async function readErrorCode(response: Response): Promise<string> {
	const parsed = errorBodyDto.safeParse(
		await response.json().catch(() => null),
	);
	return parsed.success ? parsed.data.error.code : "unknown";
}

// RFC 9110 §10.2.3: delta-seconds or an HTTP-date.
function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	if (/^\d+$/.test(header.trim())) return Number(header) * 1000;
	const ms = Date.parse(header) - Date.now();
	return Number.isFinite(ms) && ms > 0 ? ms : null;
}
