import { describe, expect, it } from "vitest";
import { accountLabel } from "./account-label";

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
