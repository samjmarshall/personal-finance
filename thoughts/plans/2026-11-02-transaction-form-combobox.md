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
- `src/app/(dashboard)/transactions/_components/combobox-field.tsx` — new `ComboboxField<T>` (`:16`) + `ComboboxFieldOption<T>` (`:13`). It maps `value` to the matching item (`:44`) and memoizes it so a parent re-render keeps half-typed text (`:46`). It emits `item?.value ?? null`, sets `autoHighlight` (`:53`) and `isItemEqualToValue` by `.value` (`:55`), and shows the clear button only when filled (`:107`). It renders `ComboboxEmpty` + `ComboboxList` of `ComboboxItem`. It controls `open` (`:40`, `:71`) for these guards, which keep a pick from being lost by accident:
  - Emptied text opens the list and keeps the pick; only the X clears (`:65`).
  - Enter with the list open never submits the form (`:87`).
  - Escape with the list shut goes to the dialog, pick kept (`:89`).
  - Tab (and Shift+Tab) on typed text takes the highlighted match, or an exact name over an automatic highlight. A row the arrow keys picked always wins, as with Enter (`:42`, `:57`, `:97`). The pick is sent on blur, so the X it shows doesn't take the Tab (`:43`, `:80`). Empty or untouched text picks nothing (`:93`). A click-away still reverts.
- `src/app/(dashboard)/transactions/_components/transaction-form.tsx` — `categoryOptions` (`:133`) and `expenseOptions` (`:139`) become `ComboboxFieldOption<number>[]`. Both fields use `ComboboxField` (`:277`, `:294`), call `pickCategory` / `pickExpense` with the numeric id (`:284`, `:302`), and pass `placeholder="None"`, `emptyText` and `clearLabel`.
- `src/components/ui/combobox.tsx` — `ComboboxInput` takes `clearLabel` for the X (`:58`, `:89`). The X is a Tab stop, so the keyboard can clear (`:92`). The chevron gets `aria-label="Show options"` and `tabIndex={-1}` (`:76`, `:83`). A long label ends in "…" (`:69`). Re-adding the shadcn component would drop these.
- `src/app/(dashboard)/transactions/_components/combobox-field.test.tsx` — 22 tests: shows the picked label (`:52`), typing filters (`:58`), a pick emits the value (`:69`), clear emits `null` (`:78`), no match shows the empty text (`:321`). Validate fixes added: keyboard reaches the X (`:86`), emptied text keeps the pick, list open or shut (`:97`, `:108`), Enter pick / no-submit (`:121`, `:231`), Tab pick / live field skips the new X / exact name / arrowed row over exact name / arrowed same-name row / reopened / arrowed reopened / no match (`:131`, `:142`, `:154`, `:167`, `:181`, `:196`, `:207`, `:219`), Escape on a shut list (`:254`), re-render keeps typed text (`:269`), Tab skips the chevron (`:297`), named X (`:307`).

### Success
- [x] `make check` passes (in the cloud container `db:check` needs a dummy `DATABASE_URL`; no schema change)
- [x] `make test` passes (146 files, 1771 tests on 2026-11-03 resolve-findings, 3rd pass)
- [x] Typing in Category / Expense filters the list. Arrow keys + Enter, or Tab, pick a match.
- [x] X clears the field; it is the only clear, and Tab reaches it. Unmatched or emptied text reverts on blur (`combobox-field.tsx:65`). Escape on a shut list keeps the pick (`:89`).
- [x] Picking a Category narrows the Expenses. Picking an Expense sets the Category. The hint updates.
- [x] The popup paints above the dialog and is not clipped. It works in light and dark mode and on a phone-width screen.
- [ ] A synced (bank-owned) transaction still opens focused on Description. Not run: all 645 local rows are manual, and only a bank sync makes synced ones. Low risk: the diff leaves the focus code alone (`transaction-form.tsx:193`). Needs one open of a synced row on a preview.
- [x] `/design-review` — no blockers; 1 high a11y issue in `combobox.tsx` trigger, fixed in `f8a244a`
- [x] `/design-review` re-run on `1d0eb01` — no blockers; 1 high: no keyboard way to clear (Base UI skips the X on Tab). Fixed by giving the X a Tab stop (`combobox.tsx:92`).
- [x] `/design-review` re-run on `4cd7e63` — no blockers, no high. 1 medium: a Tab pick shows the X mid-Tab and focus stops on it, not the next field. Fixed by sending the Tab pick on blur (`combobox-field.tsx:80`).

## References
- PR: samjmarshall/personal-finance#125 (commit `f812a3f`)
- ADRs: `docs/adr/adr025-linked-expense-sets-the-category.md` (Accepted 2026-11-03) — rules kept unchanged; `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` (Accepted) — why a shadcn/Base UI primitive
- Prior plan: commit `802f1f8` (pick Category before Expense, filter Expenses by Category)
- Related: `src/components/select-field.tsx:34`, `src/components/select-field.test.tsx` (test pattern), `src/components/ui/combobox.tsx:52`, `category-expense-link.ts:21`
