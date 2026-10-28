import { describe, expect, it } from "vitest";
import { CdrConnectionStatus } from "~/lib/constants";
import {
	cdrImportStartDto,
	cdrSetInBalanceDto,
	cdrSetNicknameDto,
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
	const account = {
		id: "acct_1",
		connection: "conn_1",
		name: "Everyday",
		type: "transaction",
		institution: { id: "inst_fk_cba", name: "CommBank", logo: null },
		account_number: "xxxx8273",
	};

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

	it("keeps the account type", () => {
		expect(
			redbarkAccountDto.parse({ ...account, status: "available" }).type,
		).toBe("transaction");
	});

	// RedBark documents no list of types; a new one is left undecided, not refused.
	it("accepts a type it hasn't seen", () => {
		expect(
			redbarkAccountDto.parse({
				...account,
				type: "term-deposit",
				status: "available",
			}).type,
		).toBe("term-deposit");
	});

	it("keeps the bank's name and the masked number", () => {
		const parsed = redbarkAccountDto.parse({ ...account, status: "available" });

		expect(parsed.institution.name).toBe("CommBank");
		expect(parsed.account_number).toBe("xxxx8273");
	});

	it("accepts an account with no number", () => {
		expect(
			redbarkAccountDto.parse({
				...account,
				account_number: null,
				status: "available",
			}).account_number,
		).toBeNull();
	});

	it("rejects an account with no type", () => {
		const { type: _, ...untyped } = account;
		expect(
			redbarkAccountDto.safeParse({ ...untyped, status: "available" }).success,
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

describe("cdrSetInBalanceDto", () => {
	it("accepts an account id and a choice", () => {
		expect(
			cdrSetInBalanceDto.parse({ accountId: "acct_1", inBalance: false }),
		).toEqual({ accountId: "acct_1", inBalance: false });
	});

	it("rejects an empty account id", () => {
		expect(
			cdrSetInBalanceDto.safeParse({ accountId: "", inBalance: true }).success,
		).toBe(false);
	});

	// Undecided is the sync's state; a member always picks one side.
	it.each([null, "true", 1])("rejects a non-boolean choice %s", (inBalance) => {
		expect(
			cdrSetInBalanceDto.safeParse({ accountId: "acct_1", inBalance }).success,
		).toBe(false);
	});
});

describe("cdrSetNicknameDto", () => {
	it("trims the name", () => {
		expect(
			cdrSetNicknameDto.parse({ accountId: "acct_1", nickname: "  Bills  " }),
		).toEqual({ accountId: "acct_1", nickname: "Bills" });
	});

	// Blank is how a member goes back to the bank's name.
	it.each(["", "   "])("turns a blank name %j into null", (nickname) => {
		expect(
			cdrSetNicknameDto.parse({ accountId: "acct_1", nickname }).nickname,
		).toBeNull();
	});

	it("accepts 40 characters and refuses 41", () => {
		const parse = (n: number) =>
			cdrSetNicknameDto.safeParse({
				accountId: "acct_1",
				nickname: "x".repeat(n),
			}).success;

		expect(parse(40)).toBe(true);
		expect(parse(41)).toBe(false);
	});

	it("rejects an empty account id", () => {
		expect(
			cdrSetNicknameDto.safeParse({ accountId: "", nickname: "Bills" }).success,
		).toBe(false);
	});
});

describe("cdrImportStartDto", () => {
	it("takes bare days from a date input", () => {
		expect(
			cdrImportStartDto.parse({ from: "2026-01-01", to: "2026-03-31" }),
		).toEqual({ from: "2026-01-01", to: "2026-03-31" });
	});

	it.each(["", "01/02/2026", "2026-02-30", "2026-01-01T00:00:00Z"])(
		"refuses %j",
		(from) => {
			expect(
				cdrImportStartDto.safeParse({ from, to: "2026-03-31" }).success,
			).toBe(false);
		},
	);
});
