import { describe, expect, it } from "vitest";
import { CdrConnectionStatus } from "~/lib/constants";
import {
	redbarkAccountDto,
	redbarkBalanceDto,
	redbarkConnectionDto,
	redbarkPageDto,
	redbarkTransactionDto,
} from "./cdr.dto";
import { creditRow, debitRow } from "./redbark.fixtures";

const page = (data: unknown[], next: string | null = null) => ({
	object: "list",
	data,
	next_page_url: next,
	previous_page_url: null,
});

describe("redbarkPageDto", () => {
	it("parses a captured transactions page", () => {
		const parsed = redbarkPageDto(redbarkTransactionDto).parse(
			page(
				[debitRow, creditRow],
				"https://api.redbark.com/v2/transactions?page=p2",
			),
		);

		expect(parsed.data.map((t) => t.id)).toEqual([debitRow.id, creditRow.id]);
		expect(parsed.next_page_url).toBe(
			"https://api.redbark.com/v2/transactions?page=p2",
		);
	});

	it("reads the last page's next_page_url as null", () => {
		expect(
			redbarkPageDto(redbarkTransactionDto).parse(page([])).next_page_url,
		).toBeNull();
	});
});

describe("redbarkTransactionDto", () => {
	// RedBark documents Money as nullable; the mapper, not the parse, decides it is fatal.
	it("accepts a null amount", () => {
		expect(
			redbarkTransactionDto.parse({ ...debitRow, amount: null }).amount,
		).toBeNull();
	});

	it("rejects a non-integer minor-unit amount", () => {
		expect(
			redbarkTransactionDto.safeParse({
				...debitRow,
				amount: { amount: 42.5, currency: "aud" },
			}).success,
		).toBe(false);
	});
});

describe("redbarkConnectionDto", () => {
	it.each(Object.values(CdrConnectionStatus))("accepts status %s", (status) => {
		expect(
			redbarkConnectionDto.parse({ id: "conn_1", status, livemode: true })
				.status,
		).toBe(status);
	});

	// A new consent state must fail loud, not sync as if it were active.
	it("rejects an unknown connection status", () => {
		expect(
			redbarkConnectionDto.safeParse({ id: "conn_1", status: "paused" })
				.success,
		).toBe(false);
	});
});

describe("redbarkAccountDto", () => {
	const account = { id: "acct_1", connection: "conn_1", name: "Everyday" };

	it.each(["available", "syncing", "unavailable"])(
		"accepts status %s",
		(status) => {
			expect(redbarkAccountDto.parse({ ...account, status }).status).toBe(
				status,
			);
		},
	);

	// A new account state must fail loud, not sync as if it were available.
	it("rejects an unknown account status", () => {
		expect(
			redbarkAccountDto.safeParse({ ...account, status: "paused" }).success,
		).toBe(false);
	});
});

describe("redbarkBalanceDto", () => {
	it("accepts the nullable fields RedBark leaves empty when a bank can't answer", () => {
		const parsed = redbarkBalanceDto.parse({
			object: "balance",
			account: "acct_1",
			current: null,
			available: null,
			currency: null,
			observed_at: null,
			freshness: null,
		});

		expect(parsed.freshness).toBeNull();
	});

	it("rejects an unknown freshness", () => {
		expect(
			redbarkBalanceDto.safeParse({
				account: "acct_1",
				current: null,
				available: null,
				observed_at: null,
				freshness: "recent",
			}).success,
		).toBe(false);
	});
});
