import { describe, expect, it } from "vitest";
import { BalanceSource } from "~/lib/constants";
import { balanceSourceLabel } from "./balance-snapshot.display";

describe("balanceSourceLabel", () => {
	it.each([
		[BalanceSource.Cdr, "Synced from bank"],
		[BalanceSource.Manual, "Entered by you"],
	])("labels a %s balance %j", (source, label) => {
		expect(balanceSourceLabel(source)).toBe(label);
	});
});
