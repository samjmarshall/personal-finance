import { describe, expect, it } from "vitest";
import {
	accountLabel,
	cashTotal,
	formatBalance,
	groupByBank,
	newAccountsNote,
	totalNote,
} from "./bank-accounts.display";

const named = {
	accountId: "acc_1",
	accountName: "Everyday Offset",
	nickname: null,
};

describe("accountLabel", () => {
	it("is the member's nickname when there is one", () => {
		expect(accountLabel({ ...named, nickname: "Bills" })).toBe("Bills");
	});

	it("falls back to the bank's name", () => {
		expect(accountLabel(named)).toBe("Everyday Offset");
	});

	it("falls back to the RedBark id when the bank sent no name", () => {
		expect(accountLabel({ ...named, accountName: null })).toBe("acc_1");
	});
});

type Row = {
	accountId: string;
	balance: number | null;
	inBalance: boolean | null;
	institutionName: string | null;
};

const row = (
	accountId: string,
	institutionName: string | null,
	balance: number | null,
	inBalance: boolean | null = true,
): Row => ({ accountId, balance, inBalance, institutionName });

describe("groupByBank", () => {
	it("orders banks A–Z, unnamed last, with each bank's counted count", () => {
		const groups = groupByBank([
			row("w1", "Westpac", 10),
			row("x1", null, 5),
			row("c1", "CommBank", 1, false),
			row("c2", "CommBank", 2),
		]);

		expect(groups.map(({ bank, counted }) => [bank, counted])).toEqual([
			["CommBank", 1],
			["Westpac", 1],
			["Other accounts", 1],
		]);
	});

	it("orders a bank's rows by balance high → low, unread last, whatever the switch", () => {
		const [group] = groupByBank([
			row("unread", "CommBank", null),
			row("owing", "CommBank", -300, false),
			row("big", "CommBank", 5000),
			row("small", "CommBank", 20, null),
		]);

		expect(group?.accounts.map((a) => a.accountId)).toEqual([
			"big",
			"small",
			"owing",
			"unread",
		]);
	});
});

describe("cashTotal", () => {
	it("sums counted balances only, a card lowering it", () => {
		expect(
			cashTotal([
				row("tx", "CommBank", 1000),
				row("card", "CommBank", -300),
				row("loan", "CommBank", -50_000, false),
			]),
		).toBe(700);
	});

	it("is null while any account is undecided", () => {
		expect(
			cashTotal([row("tx", "CommBank", 1000), row("td", "CommBank", 5, null)]),
		).toBeNull();
	});

	it("is null while a counted balance is unread", () => {
		expect(cashTotal([row("tx", "CommBank", null)])).toBeNull();
	});

	it("ignores a left-out account's unread balance", () => {
		expect(
			cashTotal([
				row("tx", "CommBank", 10),
				row("loan", "CommBank", null, false),
			]),
		).toBe(10);
	});
});

describe("totalNote", () => {
	it.each([
		["1 of 2 accounts counted", [row("a", "B", 1), row("b", "B", 2, false)]],
		["Waiting on 1 new account", [row("a", "B", 1, null)]],
		[
			"Waiting on 2 new accounts",
			[row("a", "B", 1, null), row("b", "B", 1, null)],
		],
		["Waiting on the next bank sync", [row("a", "B", null)]],
	])("%s", (note, accounts) => {
		expect(totalNote(accounts)).toBe(note);
	});
});

describe("newAccountsNote", () => {
	it.each([
		[null, [row("a", "B", 1), row("b", "B", 2, false)]],
		[
			"1 new account needs a choice. Find it marked New below.",
			[row("a", "B", 1, null), row("b", "B", 2)],
		],
		[
			"2 new accounts need a choice. Find them marked New below.",
			[row("a", "B", 1, null), row("b", "B", 1, null)],
		],
	])("%s", (note, accounts) => {
		expect(newAccountsNote(accounts)).toBe(note);
	});
});

describe("formatBalance", () => {
	it("uses a real minus sign for money owed", () => {
		expect(formatBalance(-8394.25)).toBe("−$8,394.25");
	});

	it("shows a positive balance plainly", () => {
		expect(formatBalance(5489.69)).toBe("$5,489.69");
	});
});
