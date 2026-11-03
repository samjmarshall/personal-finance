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
- shadcn combobox primitives were installed but unused: `src/components/ui/combobox.tsx`. `ComboboxInput` has `showClear` (`:52`, `:87`). The popup sits at z-100 above dialogs (`:115`). `ComboboxEmpty` stays mounted as a live region (`:202`).
- Base UI 1.9.0 Combobox reads `{ value, label }` items on its own and takes `isItemEqualToValue` + `autoHighlight`.

## Desired End State
- Category and Expense inputs filter their list as you type (case-insensitive, contains).
- You can only pick existing items. Text that matches nothing, or emptied text, goes back to the picked label on blur.
- An X button clears a filled field to `null`. No `"— None —"` row. Empty field shows placeholder "None".
- No match shows "No categories found." / "No expenses found.".
- Picking a Category still narrows the Expenses. Picking an Expense still sets its Category. The Expense hint line still updates (`transaction-form.tsx:143`, `:306`).
- Fields lock while saving (`disabled={pending}`). Label `htmlFor` ids (`tx-category`, `tx-expense`) and `aria-describedby="tx-expense-hint"` still work.

## Out of Scope
- Making a new Category or Expense from typed text.
- Frequency and Priority fields (short fixed enums, stay `SelectField`, `transaction-form.tsx:313`, `:324`).
- Other forms (`expenses/_components/expense-form.tsx`, `expenses/categories/_components/category-form.tsx`).
- Moving `ComboboxField` to `src/components/`. Move it up when another page imports it: same parent → `transactions/_components/` stays, 2+ parents → `src/components/` (`.claude/rules/ui-components.md`).

## Approach
Add a thin `ComboboxField<T>` wrapper over the shadcn primitives, with props shaped like `SelectField`'s, so the form swap is small. Not drop-in: it has no `readOnly`, `loading`, `aria-label` or option `title`, and adds `emptyText` (and `clearLabel`). Options become `{ value: number; label: string }`, which drops the `String()`/`Number()` round-trip. The existing link helpers handle `null` as-is.

## Phase 1: ComboboxField + form swap
### Changes
- `src/app/(dashboard)/transactions/_components/combobox-field.tsx` — new `ComboboxField<T>` (`:16`) + `ComboboxFieldOption<T>` (`:13`). It maps `value` to the matching item (`:42`) and memoizes it so a parent re-render keeps half-typed text (`:44`). It emits `item?.value ?? null`, sets `autoHighlight` (`:51`) and `isItemEqualToValue` by `.value` (`:53`), and shows the clear button only when filled (`:90`). It renders `ComboboxEmpty` + `ComboboxList` of `ComboboxItem`. It controls `open` (`:40`, `:68`) for these guards, which keep a pick from being lost by accident:
  - Emptied text opens the list and keeps the pick; only the X clears (`:62`).
  - Enter with the list open never submits the form (`:79`).
  - Escape with the list shut goes to the dialog, pick kept (`:81`).
  - Tab takes the highlighted match of a typed search (`:41`, `:55`, `:85`).
- `src/app/(dashboard)/transactions/_components/transaction-form.tsx` — `categoryOptions` (`:133`) and `expenseOptions` (`:139`) become `ComboboxFieldOption<number>[]`. Both fields use `ComboboxField` (`:277`, `:294`), call `pickCategory` / `pickExpense` with the numeric id (`:284`, `:302`), and pass `placeholder="None"`, `emptyText` and `clearLabel`.
- `src/components/ui/combobox.tsx` — `ComboboxInput` takes `clearLabel` for the X (`:58`, `:88`). The chevron gets `aria-label="Show options"` and `tabIndex={-1}` (`:76`, `:83`). A long label ends in "…" (`:69`). Re-adding the shadcn component would drop these.
- `src/app/(dashboard)/transactions/_components/combobox-field.test.tsx` — 16 tests: shows the picked label (`:33`), typing filters (`:39`), a pick emits the value (`:50`), clear emits `null` (`:59`), no match shows the empty text (`:225`). Validate fixes added: emptied text keeps the pick, list open or shut (`:67`, `:78`), Enter pick / no-submit (`:91`, `:135`), Tab pick / reopened / no match (`:101`, `:112`, `:123`), Escape on a shut list (`:158`), re-render keeps typed text (`:173`), Tab skips the chevron (`:201`), named X (`:211`).

### Success
- [x] `make check` passes (in the cloud container `db:check` needs a dummy `DATABASE_URL`; no schema change)
- [x] `make test` passes (146 files, 1765 tests on 2026-11-03 resolve-findings)
- [x] Typing in Category / Expense filters the list. Arrow keys + Enter, or Tab, pick a match.
- [x] X clears the field; it is the only clear. Unmatched or emptied text reverts on blur (`combobox-field.tsx:62`). Escape on a shut list keeps the pick (`:81`).
- [x] Picking a Category narrows the Expenses. Picking an Expense sets the Category. The hint updates.
- [x] The popup paints above the dialog and is not clipped. It works in light and dark mode and on a phone-width screen.
- [ ] A synced (bank-owned) transaction still opens focused on Description. Not run: all 645 local rows are manual, and only a bank sync makes synced ones. Low risk: the diff leaves the focus code alone (`transaction-form.tsx:193`). Needs one open of a synced row on a preview.
- [x] `/design-review` — no blockers; 1 high a11y issue in `combobox.tsx` trigger, fixed in `f8a244a`

## References
- PR: samjmarshall/personal-finance#125 (commit `f812a3f`)
- ADRs: `docs/adr/adr025-linked-expense-sets-the-category.md` (Accepted 2026-11-03) — rules kept unchanged; `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` (Accepted) — why a shadcn/Base UI primitive
- Prior plan: commit `802f1f8` (pick Category before Expense, filter Expenses by Category)
- Related: `src/components/select-field.tsx:34`, `src/components/select-field.test.tsx` (test pattern), `src/components/ui/combobox.tsx:52`, `category-expense-link.ts:21`
