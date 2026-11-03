---
date: 2026-11-02
adrs: [adr008, adr025]
status: Done
---
# Transaction Form Type-to-Search Category + Expense Implementation Plan

## Context
The transaction form's Category and Expense fields are click-to-scroll selects. Long lists are slow to scan. Swap both for a shadcn combobox: type text, the list filters, pick a match. Built in PR samjmarshall/personal-finance#125.

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
- `src/app/(dashboard)/transactions/_components/combobox-field.tsx` — new `ComboboxField<T>` (`:16`) + `ComboboxFieldOption<T>` (`:13`). It maps `value` to the matching item (`:44`) and memoizes it so a parent re-render keeps half-typed text (`:57`). A saved value missing from a stale list stays picked, nameless, so the X can unlink it. It emits `item?.value ?? null`, sets `autoHighlight` (`:64`) and `isItemEqualToValue` by `.value` (`:66`), and shows the clear button only when filled and not mid-search (`:110`). It renders `ComboboxEmpty` + `ComboboxList` of `ComboboxItem`. It controls `open` (`:40`, `:72`) for these guards, which keep a pick from being lost by accident:
  - Emptied text opens the list and keeps the pick; only the X clears (`:76`).
  - Enter with the list open never submits the form (`:99`).
  - Escape with the list shut goes to the dialog, pick kept (`:101`).
  - Tab (and Shift+Tab) on typed text takes the highlighted row, the same one Enter takes (`:104`). A typed full name lists first, so it is the row lit (`:47`). The pick is sent on blur, so the X it shows doesn't take the Tab (`:43`, `:91`). On empty or untouched text Tab picks nothing (`:46`), but Enter still takes the lit row: one the arrows lit, or the top row Base UI leaves lit once a search is deleted. A click-away still reverts.
- `src/app/(dashboard)/transactions/_components/transaction-form.tsx` — `categoryOptions` (`:133`) and `expenseOptions` (`:139`) become `ComboboxFieldOption<number>[]`. Both fields use `ComboboxField` (`:277`, `:294`), call `pickCategory` / `pickExpense` with the numeric id (`:284`, `:302`), and pass `placeholder="None"`, `emptyText` and `clearLabel`.
- `src/components/ui/combobox.tsx` — `ComboboxInput` takes `clearLabel` for the X (`:58`, `:89`). The X is a Tab stop, so the keyboard can clear (`:92`). The chevron gets `aria-label="Show options"` and `tabIndex={-1}` (`:76`, `:83`). A long label ends in "…" (`:69`). Re-adding the shadcn component would drop these.
- `src/app/(dashboard)/transactions/_components/combobox-field.test.tsx` — 28 tests, all through one harness that feeds each pick back like the form (`:13`): shows the picked label (`:53`), typing filters (`:59`), a pick emits the value (`:70`), clear emits `null` (`:79`), no match shows the empty text (`:395`). Validate fixes added: a saved value missing from the list can be cleared (`:87`), keyboard reaches the X (`:97`), emptied text keeps the pick, list open or shut (`:108`, `:119`), Enter pick / no-submit (`:132`, `:305`), Tab pick sent once / Shift+Tab / live field skips the new X / filled field skips its X / exact name / exact name lists first, lit / hovered row / arrowed row over exact name / arrowed same-name row / reopened / arrowed reopened / no match (`:142`, `:153`, `:164`, `:175`, `:188`, `:201`, `:216`, `:229`, `:243`, `:258`, `:269`, `:281`), click-away keeps the pick (`:293`), Escape on a shut list (`:328`), re-render keeps typed text (`:343`), Tab skips the chevron (`:371`), named X (`:381`).

### Success
- [x] `make check` passes (in the cloud container `db:check` needs a dummy `DATABASE_URL`; no schema change)
- [x] `make test` passes (146 files, 1777 tests on 2026-11-03 resolve-findings, 4th pass)
- [x] Typing in Category / Expense filters the list. Arrow keys + Enter, or Tab, pick a match.
- [x] X clears the field; it is the only clear, and Tab reaches it. Unmatched or emptied text reverts on blur (Base UI restores the label; the emptied-text guard is `combobox-field.tsx:76`). Escape on a shut list keeps the pick (`:101`).
- [x] Picking a Category narrows the Expenses. Picking an Expense sets the Category. The hint updates.
- [x] The popup paints above the dialog and is not clipped. It works in light and dark mode and on a phone-width screen.
- [ ] A synced (bank-owned) transaction still opens focused on Description. Not run: all 645 local rows are manual, and only a bank sync makes synced ones. Low risk: the diff leaves the focus code alone (`transaction-form.tsx:193`). Needs one open of a synced row on a preview.
- [x] `/design-review` — no blockers; 1 high a11y issue in `combobox.tsx` trigger, fixed in `f8a244a`
- [x] `/design-review` re-run on `1d0eb01` — no blockers; 1 high: no keyboard way to clear (Base UI skips the X on Tab). Fixed by giving the X a Tab stop (`combobox.tsx:92`).
- [x] `/design-review` re-run on `4cd7e63` — no blockers, no high. 1 medium: a Tab pick shows the X mid-Tab and focus stops on it, not the next field. Fixed for an empty field by sending the Tab pick on blur (`combobox-field.tsx:91`).
- [x] `/design-review` re-run on `80eccc7` — no blockers, no high. Empty-field Tab pick, arrowed row and same-name rows checked live. 5 medium open: a Tab pick on a filled field still stops on its X; Category change drops the Expense silently; a hovered row loses to an exact name on Tab; same-name Expenses look alike; a stale Tab pick can outlive its keypress. Resolved: the filled-field X hides mid-search (`combobox-field.tsx:110`); an exact name lists first, so Tab takes the lit row, hovered or not (`:52`). Skipped: the other 3 (older rule, not this change, or needs a faked Tab).

## References
- PR: samjmarshall/personal-finance#125 — feature `f812a3f`; fixes `f8a244a`, `6e6ff58`, `1d0eb01`, `4cd7e63`, `80eccc7`
- ADRs: `docs/adr/adr025-linked-expense-sets-the-category.md` (Accepted 2026-11-03) — rules kept unchanged; `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` (Accepted) — why a shadcn/Base UI primitive
- Prior work: PR #124, commit `802f1f8` (pick Category before Expense, filter Expenses by Category)
- Related: `src/components/select-field.tsx:34`, `src/components/select-field.test.tsx` (test pattern), `src/components/ui/combobox.tsx:52`, `category-expense-link.ts:21`
