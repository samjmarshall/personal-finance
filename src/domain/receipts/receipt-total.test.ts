import { describe, expect, it } from "vitest";
import { itemsTotalMismatch } from "./receipt-total";

describe("itemsTotalMismatch", () => {
	const cases: {
		name: string;
		total: number | null;
		items: { price: number; quantity: number }[];
		expected: boolean;
	}[] = [
		{
			name: "items sum to the total → no mismatch",
			total: 8.99,
			items: [
				{ price: 3.99, quantity: 1 },
				{ price: 2.5, quantity: 2 },
			],
			expected: false,
		},
		{
			name: "items clearly diverge from the total → mismatch",
			total: 20,
			items: [{ price: 3.99, quantity: 1 }],
			expected: true,
		},
		{
			name: "sub-cent rounding drift is tolerated",
			total: 10,
			items: [{ price: 3.333, quantity: 3 }],
			expected: false,
		},
		{
			name: "no extracted items → nothing to reconcile, no badge",
			total: 20,
			items: [],
			expected: false,
		},
		{
			name: "no extracted total → nothing to reconcile, no badge",
			total: null,
			items: [{ price: 3.99, quantity: 1 }],
			expected: false,
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			expect(itemsTotalMismatch(c.total, c.items)).toBe(c.expected);
		});
	}
});
