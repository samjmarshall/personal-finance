import { describe, expect, it } from "vitest";

import { groupByCategory } from "./group-by-category";

const CATEGORIES = [
	{ id: 2, name: "Bills" },
	{ id: 1, name: "Food" },
	{ id: 3, name: "Travel" },
];

describe("groupByCategory", () => {
	it("follows the saved Category order and skips empty Categories", () => {
		const items = [
			{ id: "a", categoryId: 1 },
			{ id: "b", categoryId: 2 },
			{ id: "c", categoryId: 1 },
		];

		expect(groupByCategory(items, CATEGORIES)).toEqual([
			{ key: "2", label: "Bills", items: [items[1]] },
			{ key: "1", label: "Food", items: [items[0], items[2]] },
		]);
	});

	// A Category added in another tab isn't in this tab's list yet.
	it("puts no Category and an unknown Category under No category, last", () => {
		const items = [
			{ id: "a", categoryId: null },
			{ id: "b", categoryId: 99 },
			{ id: "c", categoryId: 3 },
		];

		expect(groupByCategory(items, CATEGORIES)).toEqual([
			{ key: "3", label: "Travel", items: [items[2]] },
			{ key: "none", label: "No category", items: [items[0], items[1]] },
		]);
	});
});
