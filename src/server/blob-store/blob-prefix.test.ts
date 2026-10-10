import { describe, expect, it } from "vitest";
import { isBranchPrefix, owns } from "./blob-prefix";

describe("owns", () => {
	it("gives a branch the pathnames under its prefix", () => {
		expect(owns("local/b/", "local/b/receipts/x.png")).toBe(true);
	});

	it("denies a branch the production pathnames it inherited", () => {
		expect(owns("local/b/", "receipts/x.png")).toBe(false);
	});

	it("denies a branch another branch's pathnames", () => {
		expect(owns("local/b/", "local/c/receipts/x.png")).toBe(false);
		expect(owns("local/b/", "preview/b/receipts/x.png")).toBe(false);
	});

	it("gives production every pathname outside the branch prefixes", () => {
		expect(owns("", "receipts/x.png")).toBe(true);
	});

	it.each(["local/b/receipts/x.png", "preview/b/receipts/x.png"])(
		"denies production the branch pathname %j",
		(pathname) => {
			expect(owns("", pathname)).toBe(false);
		},
	);
});

describe("isBranchPrefix", () => {
	it.each(["local/b/", "preview/feat/x/"])("accepts %j", (prefix) => {
		expect(isBranchPrefix(prefix)).toBe(true);
	});

	it.each(["", "local/", "preview/", "production/b/", "local/b"])(
		"rejects %j",
		(prefix) => {
			expect(isBranchPrefix(prefix)).toBe(false);
		},
	);
});
