import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import type { AllowedSender } from "~/domain/allowed-senders/allowed-sender.interface";
import type { BalanceSnapshot } from "~/domain/balances/balance.interface";
import type { Category } from "~/domain/categories/category.interface";
import type { CdrSyncState } from "~/domain/cdr/cdr.interface";
import type { Expense } from "~/domain/expenses/expense.interface";
import type { Income } from "~/domain/income/income.interface";
import type { Receipt, ReceiptItem } from "~/domain/receipts/receipt.interface";
import type {
	PossibleDuplicate,
	Transaction,
} from "~/domain/transactions/transaction.interface";
import type { allowedSenders } from "~/server/allowed-senders/allowed-senders.schema";
import type { balanceSnapshots } from "~/server/balances/balances.schema";
import type { categories } from "~/server/categories/categories.schema";
import type { cdrSyncState } from "~/server/cdr/cdr.schema";
import type { expenses } from "~/server/expenses/expenses.schema";
import type { income } from "~/server/income/income.schema";
import type { receiptItems, receipts } from "~/server/receipts/receipts.schema";
import type {
	possibleDuplicates,
	transactions,
} from "~/server/transactions/transactions.schema";
import type { Equal, Expect } from "~/test/type-contracts";

// One `true` per aligned pair. A schema change that breaks an interface — or an
// interface change that would need a column/migration — makes an element
// `Expect<false>`, which errors at this alias under `make check` typecheck.
// TransactionListItem/TransactionSummary are table-less read-models, out of scope.
type Contracts = [
	Expect<Equal<typeof balanceSnapshots.$inferSelect, BalanceSnapshot>>,
	Expect<Equal<typeof income.$inferSelect, Income>>,
	Expect<Equal<typeof expenses.$inferSelect, Expense>>,
	Expect<Equal<typeof transactions.$inferSelect, Transaction>>,
	Expect<Equal<typeof categories.$inferSelect, Category>>,
	Expect<Equal<typeof receipts.$inferSelect, Receipt>>,
	Expect<Equal<typeof allowedSenders.$inferSelect, AllowedSender>>,
	Expect<Equal<typeof cdrSyncState.$inferSelect, CdrSyncState>>,
];

// receipt_item and possible_duplicate share their parent's interface file, so they
// can't get their own COVERED slug; these standalone aliases still error on drift.
type _ReceiptItemContract = Expect<
	Equal<typeof receiptItems.$inferSelect, ReceiptItem>
>;
type _PossibleDuplicateContract = Expect<
	Equal<typeof possibleDuplicates.$inferSelect, PossibleDuplicate>
>;

// Entities whose *.interface.ts is pinned by `Contracts`. A new interface file with
// no contract fails the coverage test, forcing a deliberate decision.
const COVERED = [
	"allowed-sender",
	"balance",
	"category",
	"cdr",
	"expense",
	"income",
	"receipt",
	"transaction",
];

// Table-less shapes: no *.schema.ts to contract against, so they sit outside the
// schema↔interface gate. Cash flow is derived; the inbound email is a webhook body,
// never stored, and is pinned to its DTO instead.
const TABLELESS = ["cashflow", "email"];

describe("schema ↔ interface contract", () => {
	it("keeps each *.schema.ts read model equal to its *.interface.ts", () => {
		// Annotating with `Contracts` makes tsc evaluate every pair above; the array is
		// contextually typed to the tuple, so it stays a genuine compile-time gate.
		const aligned: Contracts = [true, true, true, true, true, true, true, true];

		expect(aligned).toHaveLength(COVERED.length);
	});

	it("covers every *.interface.ts with a type contract", () => {
		const slugs = (readdirSync("src/domain", { recursive: true }) as string[])
			.filter((f) => f.endsWith(".interface.ts"))
			.map((f) => basename(f).replace(".interface.ts", ""))
			.filter((slug) => !TABLELESS.includes(slug))
			.sort();

		expect(slugs).toEqual([...COVERED].sort());
	});
});
