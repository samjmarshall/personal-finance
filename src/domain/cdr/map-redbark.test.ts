import { describe, expect, it } from "vitest";
import { Provenance } from "~/lib/constants";
import {
	type RedbarkBalance,
	type RedbarkTransaction,
	redbarkTransactionDto,
} from "./cdr.dto";
import {
	anchorFromBalances,
	inBalanceByDefault,
	latestBalance,
	mapRedbarkTransaction,
} from "./map-redbark";
import { creditRow, debitRow } from "./redbark.fixtures";

const row = (over: Partial<RedbarkTransaction> = {}): RedbarkTransaction => ({
	id: "txn_1",
	account: "acct_1",
	date: "2026-10-01",
	description: "WOOLWORTHS 1234",
	amount: { amount: -4250, currency: "aud" },
	direction: "debit",
	status: "posted",
	...over,
});

const money = (amount: number, currency = "aud") => ({ amount, currency });

describe("mapRedbarkTransaction", () => {
	it("maps a row to a cdr-provenance synced transaction", () => {
		expect(mapRedbarkTransaction(row(), "Everyday")).toEqual({
			provenance: Provenance.Cdr,
			externalId: "txn_1",
			accountName: "Everyday",
			amount: 42.5,
			date: new Date("2026-10-01T00:00:00.000Z"),
			description: "WOOLWORTHS 1234",
		});
	});

	// App glossary: positive = Spend, negative = Inflow (CONTEXT.md), the opposite
	// of CDR's account-holder sign.
	it.each([
		["debit → Spend positive", "debit", -4250, 42.5],
		["credit → Inflow negative", "credit", 250000, -2500],
		["no direction → negated", null, -1999, 19.99],
		["no direction, money in → negated", undefined, 1000, -10],
		["one cent", "debit", -1, 0.01],
		["zero stays zero", "credit", 0, 0],
	] as const)("%s", (_, direction, minor, expected) => {
		expect(
			mapRedbarkTransaction(row({ direction, amount: money(minor) }), "a")
				.amount,
		).toBe(expected);
	});

	// A sign we can't trust must stop the sync, not land Spend as Inflow.
	it.each([
		["debit with a positive number", "debit", 4250],
		["credit with a negative number", "credit", -4250],
	] as const)("throws on %s", (_, direction, minor) => {
		expect(() =>
			mapRedbarkTransaction(row({ direction, amount: money(minor) }), "a"),
		).toThrow(/disagrees/);
	});

	it.each(["usd", "nzd"])("throws on a %s row", (currency) => {
		expect(() =>
			mapRedbarkTransaction(row({ amount: money(-100, currency) }), "a"),
		).toThrow(/currency/);
	});

	it("accepts an upper-case AUD currency", () => {
		expect(
			mapRedbarkTransaction(row({ amount: money(-100, "AUD") }), "a").amount,
		).toBe(1);
	});

	// Settled-only must not rest on one query param of a beta API (adr017 facet 3).
	it("throws on a pending row", () => {
		expect(() =>
			mapRedbarkTransaction(row({ status: "pending" }), "a"),
		).toThrow(/not settled/);
	});

	it.each([null, undefined])("maps a row with %s status", (status) => {
		expect(mapRedbarkTransaction(row({ status }), "a").amount).toBe(42.5);
	});

	it("throws on a row with no amount", () => {
		expect(() => mapRedbarkTransaction(row({ amount: null }), "a")).toThrow(
			/no amount/,
		);
	});

	describe("pinned against full-shape RedBark rows", () => {
		it("maps the settled debit to Spend", () => {
			const mapped = mapRedbarkTransaction(
				redbarkTransactionDto.parse(debitRow),
				"a",
			);
			expect(mapped.amount).toBeGreaterThan(0);
			expect(mapped.amount).toBe(-debitRow.amount.amount / 100);
		});

		it("maps the settled credit to Inflow", () => {
			const mapped = mapRedbarkTransaction(
				redbarkTransactionDto.parse(creditRow),
				"a",
			);
			expect(mapped.amount).toBeLessThan(0);
			expect(mapped.amount).toBe(-creditRow.amount.amount / 100);
		});
	});
});

describe("inBalanceByDefault", () => {
	it.each(["transaction", "savings", "credit-card"])(
		"counts a %s account",
		(type) => {
			expect(inBalanceByDefault(type)).toBe(true);
		},
	);

	it("leaves a loan out", () => {
		expect(inBalanceByDefault("loan")).toBe(false);
	});

	// An unknown type might be savings under another name, so a person decides.
	it.each(["term-deposit", "Savings", ""])("leaves %j undecided", (type) => {
		expect(inBalanceByDefault(type)).toBeNull();
	});
});

describe("anchorFromBalances", () => {
	const balance = (over: Partial<RedbarkBalance> = {}): RedbarkBalance => ({
		account: "acct_1",
		current: money(1_000_00),
		freshness: "fresh",
		observed_at: "2026-10-20T01:00:00Z",
		...over,
	});

	it("sums every current balance in dollars, as of the oldest reading", () => {
		expect(
			anchorFromBalances([
				balance({
					current: money(1_000_10),
					observed_at: "2026-10-20T03:00:00Z",
				}),
				balance({
					current: money(250_20),
					observed_at: "2026-10-20T01:00:00+00:00",
				}),
			]),
		).toEqual({ amount: 1250.3, asOf: new Date("2026-10-20T01:00:00.000Z") });
	});

	// CDR signs a card balance negative when money is owed (confirmed live, adr017 facet 6).
	it("lowers the sum by a credit card's negative balance", () => {
		expect(
			anchorFromBalances([
				balance({ current: money(1_000_00) }),
				balance({ current: money(-300_00) }),
			])?.amount,
		).toBe(700);
	});

	it("gives null when any balance is stale", () => {
		expect(
			anchorFromBalances([balance(), balance({ freshness: "stale" })]),
		).toBeNull();
	});

	it.each([
		["no freshness", { freshness: null }],
		["freshness unavailable", { freshness: "unavailable" }],
		["no current", { current: null }],
		["no observed_at", { observed_at: null }],
	] as const)("gives null when a balance has %s", (_, over) => {
		expect(anchorFromBalances([balance(), balance(over)])).toBeNull();
	});

	it("gives null for no balances", () => {
		expect(anchorFromBalances([])).toBeNull();
	});

	it("throws on a non-AUD balance", () => {
		expect(() =>
			anchorFromBalances([balance(), balance({ current: money(100, "usd") })]),
		).toThrow(/currency/);
	});
});

describe("latestBalance", () => {
	const balance = (over: Partial<RedbarkBalance> = {}): RedbarkBalance => ({
		account: "acct_1",
		current: money(-8_394_25),
		freshness: "stale",
		observed_at: "2026-10-20T01:00:00Z",
		...over,
	});

	// The list shows the last known balance, so a stale one is still worth keeping.
	it("gives dollars and when the bank read them, fresh or not", () => {
		expect(latestBalance(balance())).toEqual({
			amount: -8394.25,
			asOf: new Date("2026-10-20T01:00:00.000Z"),
		});
	});

	it.each([
		["no current", { current: null }],
		["no observed_at", { observed_at: null }],
		["a non-AUD currency", { current: money(100, "usd") }],
	] as const)("gives null for %s", (_, over) => {
		expect(latestBalance(balance(over))).toBeNull();
	});
});
