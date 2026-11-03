---
date: 2026-11-02
adrs: [adr008, adr025]
status: Done
---
# Transaction Form Type-to-Search Category + Expense Implementation Plan

## Context
The transaction form's Category and Expense fields are click-to-scroll selects. Long lists are slow to scan. Swap both for a shadcn combobox: type text, the list filters, pick a match. Shipped in PR samjmarshall/personal-finance#125.

## Current State
- Before: both fields used `SelectField` (`src/components/select-field.tsx:34`), with string ids and a `"— None —"` row (`802f1f8:src/app/(dashboard)/transactions/_components/transaction-form.tsx:133`, `:143`, `:281`, `:297`).
- Categories come only from the managed list, never made mid-entry (`transaction-form.tsx:132`). An Expense needs amount/frequency to exist, so the form can't create one either.
- Category ⇄ Expense rules (adr025) live in `category-expense-link.ts`: `expensesInCategory` (`:12`), `pickCategory` (`:21`), `pickExpense` (`:32`).
- shadcn combobox primitives were installed but unused: `src/components/ui/combobox.tsx`. `ComboboxInput` has `showClear` (`:52`, `:80`). The popup sits at z-100 above dialogs (`:107`). `ComboboxEmpty` stays mounted as a live region (`:193`).
- Base UI 1.9.0 Combobox reads `{ value, label }` items on its own and takes `isItemEqualToValue` + `autoHighlight`.

## Desired End State
- Category and Expense inputs filter their list as you type (case-insensitive, contains).
- You can only pick existing items. Text that matches nothing goes back to the picked label on blur.
- An X button clears a filled field to `null`. No `"— None —"` row. Empty field shows placeholder "None".
- No match shows "No categories found." / "No expenses found.".
- Picking a Category still narrows the Expenses. Picking an Expense still sets its Category. The Expense hint line still updates (`transaction-form.tsx:143`, `:305`).
- Fields lock while saving (`disabled={pending}`). Label `htmlFor` ids (`tx-category`, `tx-expense`) and `aria-describedby="tx-expense-hint"` still work.

## Out of Scope
- Making a new Category or Expense from typed text.
- Frequency and Priority fields (short fixed enums, stay `SelectField`, `transaction-form.tsx:311`, `:322`).
- Other forms (`expenses/_components/expense-form.tsx`, `expenses/categories/_components/category-form.tsx`).
- Moving `ComboboxField` to `src/components/`. Move it up when another page imports it: same parent → `transactions/_components/` stays, 2+ parents → `src/components/` (`.claude/rules/ui-components.md`).

## Approach
Add a thin `ComboboxField<T>` wrapper over the shadcn primitives, with props shaped like `SelectField`'s, so the form swap is small. Not drop-in: it has no `readOnly`, `loading`, `aria-label` or option `title`, and adds `emptyText` (and `clearLabel`). Options become `{ value: number; label: string }`, which drops the `String()`/`Number()` round-trip. The existing link helpers handle `null` as-is.

## Phase 1: ComboboxField + form swap
### Changes
- `src/app/(dashboard)/transactions/_components/combobox-field.tsx` — new `ComboboxField<T>` (`:19`) + `ComboboxFieldOption<T>` (`:12`). It maps `value` to the matching item (`:40`), emits `item?.value ?? null`, sets `autoHighlight` (`:44`) and `isItemEqualToValue` by `.value` (`:46`), and shows the clear button only when filled (`:57`). It renders `ComboboxEmpty` + `ComboboxList` of `ComboboxItem`.
- `src/app/(dashboard)/transactions/_components/transaction-form.tsx` — `categoryOptions` (`:133`) and `expenseOptions` (`:139`) become `ComboboxFieldOption<number>[]`. Both fields use `ComboboxField` (`:277`, `:293`), call `pickCategory` / `pickExpense` with the numeric id (`:283`, `:300`), and pass `placeholder="None"` and `emptyText`.
- `src/app/(dashboard)/transactions/_components/combobox-field.test.tsx` — 5 tests: shows the picked label (`:32`), typing filters (`:38`), a pick emits the value (`:49`), clear emits `null` (`:58`), no match shows the empty text (`:66`).

### Success
- [x] `make check` passes (in the cloud container `db:check` needs a dummy `DATABASE_URL`; no schema change)
- [x] `make test` passes (146 files, 1754 tests on 2026-11-03 validate)
- [x] Typing in Category / Expense filters the list. Arrow keys + Enter pick a match.
- [x] X clears the field. Unmatched text reverts on blur. (Emptied text or Escape on a closed list clears instead — see validate findings.)
- [x] Picking a Category narrows the Expenses. Picking an Expense sets the Category. The hint updates.
- [x] The popup paints above the dialog and is not clipped. It works in light and dark mode and on a phone-width screen.
- [x] A synced (bank-owned) transaction still opens focused on Description. (Simulated: local branch has no synced rows.)
- [x] `/design-review` — no blockers; 1 high a11y issue in `combobox.tsx` trigger

## References
- PR: samjmarshall/personal-finance#125 (commit `f812a3f`)
- ADRs: `docs/adr/adr025-linked-expense-sets-the-category.md` (Accepted 2026-11-03) — rules kept unchanged; `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` (Accepted) — why a shadcn/Base UI primitive
- Prior plan: commit `802f1f8` (pick Category before Expense, filter Expenses by Category)
- Related: `src/components/select-field.tsx:34`, `src/components/select-field.test.tsx` (test pattern), `src/components/ui/combobox.tsx:52`, `category-expense-link.ts:21`
