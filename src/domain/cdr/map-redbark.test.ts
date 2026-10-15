import { describe, expect, it } from "vitest";
import { Provenance } from "~/lib/constants";
import { type RedbarkTransaction, redbarkTransactionDto } from "./cdr.dto";
import { mapRedbarkTransaction } from "./map-redbark";
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
