import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";

import type { Category } from "~/domain/categories/category.interface";
import type { Expense } from "~/domain/expenses/expense.interface";
import type { Income } from "~/domain/income/income.interface";
import type { Transaction } from "~/domain/transactions/transaction.interface";
import type { expenseCategories } from "~/server/expenses/categories.schema";
import type { expenses } from "~/server/expenses/expenses.schema";
import type { income } from "~/server/income/income.schema";
import type { transactions } from "~/server/transactions/transactions.schema";
import type { Equal, Expect } from "~/test/type-contracts";

// One `true` per aligned pair. A schema change that breaks an interface — or an
// interface change that would need a column/migration — makes an element
// `Expect<false>`, which errors at this alias under `make check` typecheck.
// `Category` omits `expenseCount` (a count() aggregate on list, not a column);
// TransactionListItem/TransactionSummary are table-less read-models, out of scope.
type Contracts = [
	Expect<Equal<typeof income.$inferSelect, Income>>,
	Expect<Equal<typeof expenses.$inferSelect, Expense>>,
	Expect<Equal<typeof transactions.$inferSelect, Transaction>>,
	Expect<
		Equal<typeof expenseCategories.$inferSelect, Omit<Category, "expenseCount">>
	>,
];

// Entities whose *.interface.ts is pinned by `Contracts`. A new interface file with
// no contract fails the coverage test, forcing a deliberate decision.
const COVERED = ["category", "expense", "income", "transaction"];

describe("schema ↔ interface contract", () => {
	it("keeps each *.schema.ts read model equal to its *.interface.ts", () => {
		// Annotating with `Contracts` makes tsc evaluate every pair above; the array is
		// contextually typed to the tuple, so it stays a genuine compile-time gate.
		const aligned: Contracts = [true, true, true, true];

		expect(aligned).toHaveLength(COVERED.length);
	});

	it("covers every *.interface.ts with a type contract", () => {
		const slugs = (readdirSync("src/domain", { recursive: true }) as string[])
			.filter((f) => f.endsWith(".interface.ts"))
			.map((f) => basename(f).replace(".interface.ts", ""))
			.sort();

		expect(slugs).toEqual([...COVERED].sort());
	});
});
