# shadcn on Base UI Migration Implementation Plan

## Context
The app's UI primitives (~2,500 lines) are hand-rolled from raw HTML: the modal has no focus trap, four `confirm()` + one `alert()` are browser dialogs, and the native `<select>` resists styling. ADR008 decided to adopt shadcn/ui on **Base UI** (the `base-nova` theme) and vendor the primitives into `src/components/ui/`; ADR009 decided react-hook-form for form state (a separate follow-up). This plan installs shadcn, migrates every hand-rolled primitive to `base-nova`, adds `dialog`/`alert-dialog`/`combobox`/`sonner`, and lands dark mode — accepting an app-wide density shift, keeping light mode's structure intact.

## Current State
- Primitives live at `src/app/_components/ui/` — **not** the shadcn-default `src/components/ui/`:
  - `src/app/_components/ui/primitives.tsx` — `Button` (5 variants, 3 sizes), `Input`, `Textarea`, `Select`, `Field`, `Badge`, `Card`
  - `src/app/_components/ui/modal.tsx` — hand-rolled dialog (Escape + scroll lock only, no focus trap)
  - `src/app/_components/ui/money.tsx` — domain currency display (kept, not replaced)
- Tokens: `src/styles/globals.css:3-40` — Tailwind v4 `@theme` block, single layer, oklch tokens, **no dark mode**; imported once at `src/app/layout.tsx:1`.
- `cn()` helper already shadcn-compatible at `src/lib/utils.ts:4` (also holds currency/date formatters; test at `src/lib/utils.test.ts`).
- No `components.json`, no `@radix-ui/*`, no `@base-ui/*`, no `class-variance-authority` — greenfield, nothing to rip out. Present: `clsx` 2.1.1, `tailwind-merge` 3.6.0, `lucide-react` 1.31.0; `zod` 4.4.3.
- `createQueryClient` at `src/trpc/query-client.ts:7` — no `MutationCache.onError` today.
- Metadata: `src/app/layout.tsx:16` `themeColor: "#2b6e63"`; `<html` at `src/app/layout.tsx:33`.
- Call sites that churn (from grep):
  - **4 `confirm()` + 1 `alert()`**: `categories-view.tsx:20` (alert), `categories-view.tsx:83`, `income-view.tsx:146`, `expenses-view.tsx:180`, `transactions-view.tsx:279`
  - **6 `<Select>`**: `transaction-form.tsx:132,144`, `transactions-view.tsx:163,178`, `expense-form.tsx:94,123`
  - **4 `<Modal>`**: `transaction-form.tsx:5,82`, `income-form.tsx:5,59`, `expense-form.tsx:5,77`, `category-form.tsx:5,60`
  - **`Card`** consumers: `(dashboard)/page.tsx`, `transactions-view.tsx`, `income-view.tsx`, `categories-view.tsx`, `expenses-view.tsx` (14 call sites per design doc)
  - **`Field`** consumers: `auth-form.tsx`, `transaction-form.tsx`, `income-form.tsx`, `expense-form.tsx`, `category-form.tsx`
- Verification: **no Makefile**. Scripts are `yarn typecheck` (`tsc --noEmit`), `yarn run check` (biome — note: `yarn check` collides with the yarn-1 builtin), `yarn build` (`next build`), `yarn test` (vitest run), `yarn run check:write`.

## Desired End State
- shadcn initialised (`components.json` `"style": "base-nova"`), Base UI primitives vendored in `src/components/ui/`.
- Every hand-rolled primitive replaced by its `base-nova` equivalent; `primitives.tsx` and `modal.tsx` deleted; `_components/ui/` gone; `money.tsx` moved to `src/app/_components/money.tsx`.
- `Modal` → real `dialog` (focus trap, focus restore, scroll lock, bounded height); the 4 `confirm()` → `alert-dialog` via a prop-taking `ConfirmDialog`; the 1 `alert()` and mutation failures → Sonner toasts wired through `MutationCache.onError`.
- `<select>` → Base UI `select` across 6 sites with `null` (not `""`) for "no selection"; category picker uses `combobox`.
- Dark mode shipped: `.dark` token layer + per-component vendored dark rules + `next-themes` provider + toggle.
- All new deps pinned (no `^`/`~`) per `.claude/rules/package.json.md`.
- Gates green: `yarn typecheck`, `yarn run check`, `yarn build`, `yarn test`; `/design-review` approved on visual phases.

## Out of Scope
Deferred to follow-ups or explicitly excluded (design doc `## Out of scope`):
- **react-hook-form migration (ADR009)** — the whole form-state rewrite (`useForm`/`Controller`, error policy, reset policy) is a *separate* follow-up plan. This plan does not implement ADR009.
- **The silent `Number(amount) || 0` coercion fix** — belongs to the react-hook-form change.
- **Extracting `transactionInput`** (`src/server/api/routers/transaction.ts:25`) into a shared schema — needed only by the form follow-up.
- **`table` component** and **Recharts** — cosmetic parity only; dashboard ships zero client JS today, keep it that way.
- **Three-state theme toggle** and **mobile theme toggle** — dark mode ships as a two-state toggle only.
- **Any category-data change** — no schema change, no foreign key, no backfill, no change to rename/delete behaviour in `category.ts`. (`expense_category.name` uniqueness under `householdId` is a tracked follow-up, not this plan.)

## Approach
Follow the design doc's validated 9-step sequencing, expanded to 11 phases so each independently-failing half (controls vs card; select vs combobox) gets its own `/design-review` gate. Vendor components into `src/components/ui/` and repoint consumers per component, shrinking `primitives.tsx` as we go, then delete it at cleanup. Light mode first, structure preserved; **dark mode last** so we author its ~35 values once against real components instead of twice. Correctness rides on typecheck + build + visual review (the doc's deliberate "no component tests" call), with two by-hand checks the automated gates can't see (Select `null` semantics, combobox inject-value).

---

## Phase 1: Init, aliases, pinned dependencies
### Changes
- Run `npx shadcn@latest init` (yarn-1 has no `dlx`; **no `-b` flag** — Base UI is the default; do **not** run `... init -b radix`).
- `components.json` (new) — set `"style": "base-nova"` (encodes both the Nova visual theme and the Base UI primitive library). Aliases: `components → ~/components`, `ui → ~/components/ui`, `utils → ~/lib/utils`, `lib → ~/lib`, `hooks → ~/hooks`.
- `package.json` — pin every dep the CLI writes with a `^` range to an exact version: `@base-ui/react` (design doc's Verified section: `@base-ui/react` 1.7.0 supersedes ADR008's `@base-ui-components/react`, the dead pre-v1 name — **confirm the real published name from the install output before pinning**), `class-variance-authority`. `clsx`/`tailwind-merge` already present.
- `src/lib/utils.ts` — verify the CLI did not clobber the existing `cn()` + formatters (read the diff; it should detect and reuse `cn`).
- `src/styles/globals.css` — the CLI writes into the file named by `components.json`'s `tailwind.css` key; **read the diff before accepting** (token restructure proper happens in Phase 2).

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes
- [x] `git diff package.json` shows no `^`/`~` on any new dependency

**Manual**
- [x] `components.json` `style` is `base-nova`
- [x] `/security-review` — N/A as a full review: CLI reused `cn()`, so `src/lib/utils.ts` was **not** modified; diff touches only `package.json`/`globals.css`/`components.json`/`yarn.lock` (no security-sensitive globs). Supply-chain surface (4 new deps) verified instead: all pinned; `@base-ui/react` 1.7.0 provenance confirmed official MUI (repo `github.com/mui/base-ui`).

## Phase 2: Token layer restructure (light only)
### Changes
- `src/styles/globals.css` — split the single `@theme` block (`:3-40`) into `:root` raw values + `@theme inline` mapped utilities; add `@custom-variant dark (&:is(.dark *))` and a `@layer base` block. Light values unchanged (dark `.dark` block deferred to Phase 11).

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes
- [x] `yarn test` passes

**Manual**
- [x] Light mode visually unchanged, save the two priority badges shifting sub-perceptually (expected) — verified on `/sign-in`: brand teal (primary/sidebar/accent) + cool-paper neutrals render as the pre-init design; init's grayscale override undone. Light `:root` values byte-identical to the pre-init `@theme` brand tokens (22 tokens, 0 mismatches).

## Phase 3: Controls — `button`, `input`, `textarea`, `badge`
### Changes
- Vendor `src/components/ui/{button,input,textarea,badge}.tsx` via `npx shadcn@latest add …`; run `yarn run check:write` after each add.
- Repoint every consumer's import from `~/app/_components/ui/primitives` to `~/components/ui/*`; drop `Button`/`Input`/`Textarea`/`Badge` from `src/app/_components/ui/primitives.tsx`. JSX/props unchanged (migration table: "none — app-wide density shift").
- Confirm Nova geometry per component against hand-rolled values — do **not** assume parity: button `h-8 px-2.5 rounded-lg` (was `h-10 px-4 rounded-md`), input `h-8 bg-transparent rounded-lg` (was `h-10 bg-card rounded-md`), focus ring `ring-3 ring-ring/50` (was `ring-2 ring-ring`).

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [ ] `/design-review` — **review on a phone viewport** (density shift is app-wide)
- [x] No hand-rolled `Button`/`Input`/`Textarea`/`Badge` imports remain

## Phase 4: `card` + restructure 14 call sites
### Changes
- Vendor `src/components/ui/card.tsx`; `yarn run check:write`.
- Nova's `card` owns its padding (`flex flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) ring-1 ring-foreground/10`); the old `Card` was a bare box with each call site passing its own `p-*`. Restructure all 14 call sites across `(dashboard)/page.tsx`, `transactions-view.tsx`, `income-view.tsx`, `categories-view.tsx`, `expenses-view.tsx` to the `Card`/`CardHeader`/`CardContent` structure and drop redundant padding classes.
- Remove `Card` from `primitives.tsx`.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [x] `/design-review` — Card/Badge/table layouts are load-bearing; light mode must not move structurally — verified light mode did not move structurally across all 5 surfaces; flush-card (`[--card-spacing:0px]`), corner clipping, and `--spacing(10)` empty-state padding all correct. Fixed one migration-caused regression (Nova's baked-in `overflow-hidden` clipped mobile summary-tile currency → income/expenses totals grids made responsive `grid-cols-1 sm:grid-cols-3`). Open design call surfaced separately: Nova's ring-only card (shadow removed per ADR008) — pre-dark-mode sign-off. Other findings (bare-button focus rings, icon touch targets, expenses hydration mismatch) are pre-existing, tracked as follow-ups.

## Phase 5: `field`
### Changes
- Vendor the `src/components/ui/field.tsx` family; `yarn run check:write`.
- Mechanically rename `Field` usage to the `field` family (`Field.Root`/`FieldLabel`/`FieldError`/…) in `auth-form.tsx`, `transaction-form.tsx`, `income-form.tsx`, `expense-form.tsx`, `category-form.tsx`. Field wiring to react-hook-form is **out of scope** (ADR009 follow-up) — keep the current uncontrolled/`key`/`useEffect` behaviour intact here.
- Remove `Field` from `primitives.tsx`.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [ ] Forms render with control sizing inherited from Phase 3 (minor visual change only)

## Phase 6: `dialog` replaces `Modal`
### Changes
- Vendor `src/components/ui/dialog.tsx`; `yarn run check:write`.
- Replace `<Modal>` in the 4 forms — `transaction-form.tsx:82`, `income-form.tsx:59`, `expense-form.tsx:77`, `category-form.tsx:60` — with `Dialog`; reshape props (title/description/footer slots). Translate Base UI API surface: `asChild` → `render` prop, `forceMount` → `keepMounted`.
- Nova's `DialogContent` ships **no height bound** (`… max-w-[calc(100%-2rem)] … rounded-xl p-4 sm:max-w-sm`, no `max-h`/`overflow`). The old `Modal` was a mobile bottom-sheet (`items-end`, `rounded-t-2xl`), 512px desktop, `p-6`, scrolled at `max-h-[90vh]`. Add a `max-h` + `overflow` bound to the vendored `dialog` — restoring scroll is a defect fix, not a restyle.
- Keep `modal.tsx` in place until Phase 10 (deleted at cleanup once all 4 consumers are off it).

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [x] `/design-review` — focus trap, scroll lock, and tall-content scroll (`max-h-[calc(100dvh-2rem)]` + `overflow-y-auto`) all PASS. Focus restore initially failed on category/expense dialogs (focus fell to `<body>`); root cause was a redundant `autoFocus` on the first input stealing floating-ui's return-focus target — removed it, re-verified 8/8 PASS across Add/Edit × Esc/Cancel/X. Pre-existing, out-of-scope follow-ups surfaced: error banners lack `role="alert"` (H2) and category/expense stale-state-on-reopen (H3, = the tracked react-hook-form reset-policy follow-up); `DialogHeader` needs `pr` to clear the X on very long titles (M1).
- [x] All 4 dialogs reshaped (width, padding, mobile)

## Phase 7: `select` — 6 sites, `null` semantics
### Changes
- Vendor `src/components/ui/select.tsx`; `yarn run check:write`.
- Migrate the 6 `<Select>` sites — `transaction-form.tsx:132,144`, `transactions-view.tsx:163,178`, `expense-form.tsx:94,123` — to Base UI `select`: `onChange`/`e.target.value` → `onValueChange`; `<option>` → `<SelectItem>`.
- **"No selection" is `null`, not `""`** — `value` is typed `Value[] | Value | null`; the clearable pattern adds an item with `value: null`; `<Select.Value>` exposes `data-placeholder`. Map `null` → `undefined` at the tRPC query boundary in the consuming call sites.
- Remove `Select` from `primitives.tsx`.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [x] `/design-review` — PASS across all 6 sites on desktop/tablet/mobile; `null` round-trip correct, no console errors, triggers match Nova geometry, popups portal over dialogs. Fixed the review's in-scope findings: H1 (Nova pinned popup to trigger width → clipped long options; changed `select.tsx` to `min-w-(--anchor-width)` so it grows to content), H2 (Clear button off-screen at 375px → `flex-wrap` on filter row), H3 (missing a11y label once a value is picked → `aria-label` on both filter triggers), M1 (select positioner lifted to `z-[100]` so a select opened in a dialog always paints above it). Deferred: H4 (expense "Per" resets to Month on Edit) is a pre-existing data-model gap — tracked as a follow-up, not caused by the select migration.
- [x] **By-hand check (invisible to automated gates):** select an option, clear back to placeholder, submit each of the 6 sites — confirm "no selection" round-trips as `null`/`undefined` and never `""` — verified live: filters send `undefined` (never `""`); the 4 form selects always carry a value; create/edit round-trips correct.

## Phase 8: `combobox` — constrained category picker
### Changes
- Vendor `src/components/ui/combobox.tsx`; `yarn run check:write`.
- Replace the category picker with `combobox`; swap its data source and drop the `transaction.categories` source (client-side data source only — **no schema/category-data change**, per Out of Scope).
- Implement the "inject the current value when absent from the list" logic for edit-of-a-since-deleted-category.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes

**Manual**
- [ ] `/design-review`
- [ ] **By-hand check against real data (invisible to all automated gates):** edit a row whose category is absent from the current list and confirm the current value is injected and displayed correctly

## Phase 9: `alert-dialog`, `ConfirmDialog`, Sonner
### Changes
- Pin and add `sonner` (exact version); vendor `src/components/ui/{alert-dialog,sonner}.tsx`; `yarn run check:write`.
- Build a prop-taking `ConfirmDialog` component (a component that takes props — **not** a `useConfirm()` hook; ADR001 restricts context to global state only) wrapping `alert-dialog`. Replace the 4 `confirm()` calls: `categories-view.tsx:83`, `income-view.tsx:146`, `expenses-view.tsx:180`, `transactions-view.tsx:279`.
- Add `<Toaster />` (Sonner) to the layout and a `MutationCache.onError` handler in `src/trpc/query-client.ts:7` (permitted as a global transport client under ADR001). Replace the `alert(err.message)` at `categories-view.tsx:20` — mutation failures now surface as Sonner toasts.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes (compiles/bundles under `SKIP_ENV_VALIDATION=1`; local `.env` lacks `DEPLOYMENT_URL`, a pre-existing setup gap unrelated to this phase)
- [x] `git diff package.json` shows `sonner` pinned (no `^`/`~`) — `sonner@2.0.8`; `next-themes` deliberately not installed (Phase 11), so `sonner.tsx` was vendored without its `useTheme` coupling (static `theme="light"`)

**Manual**
- [x] `/design-review` — **live browser blocked** by a pre-existing env issue (the `main`-branch Neon DB is out-of-sync on better-auth `user`/`session` tables → `/api/auth/*` returns HTTP 500, so no authed route is reachable). Not a Phase 9 defect. Static-code review PASS on all four surfaces: in-app `alert-dialog` replaces `confirm()`, correct `Delete "…"?` titles, destructive/outline buttons, Cancel/Esc/backdrop close without mutating, `role="alertdialog"` + aria wiring, `z-50` portal over lists, zero residual browser dialogs. Fixed in-scope findings: focus-restore landing on an invisible row action (added `focus-within:opacity-100` on transactions/income/expenses rows) and a dead `cn-toast` classname (removed). Deferred (see Follow-ups): form double-error-reporting, destructive focus-ring contrast, catch-all error masking.
- [x] Each of the 4 deletes prompts an accessible `alert-dialog` (focus-trapped); a failing mutation shows a Sonner toast; no browser `confirm()`/`alert()` remain — code-verified (grep confirms zero residual `confirm()`/`alert()` in `src/`); **live acceptance pending the auth-DB env fix**.

## Phase 10: Delete hand-rolled primitives, move `money.tsx`
### Changes
- Delete `src/app/_components/ui/primitives.tsx` and `src/app/_components/ui/modal.tsx`; remove the now-empty `src/app/_components/ui/` directory.
- Move `src/app/_components/ui/money.tsx` → `src/app/_components/money.tsx` (flat, beside `page-header.tsx`); update its importers.
- Grep to confirm zero remaining imports from `~/app/_components/ui/*`.

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes (import order re-sorted for the new `money` path via `check:write`)
- [x] `yarn build` passes (under `SKIP_ENV_VALIDATION=1`; local `.env` lacks `DEPLOYMENT_URL`, the pre-existing setup gap from Phase 9)
- [x] `yarn test` passes (21 passed)
- [x] `rg "_components/ui/" src/` returns nothing

**Manual**
- [x] No visual change (pure move/delete — only import paths changed, `Money` JSX/props identical)

## Phase 11: Dark mode
### Changes
- Pin and add `next-themes` (exact version). Add a `ThemeProvider` and a two-state toggle (no three-state, no separate mobile toggle — Out of Scope).
- `src/app/layout.tsx` — change `themeColor` at `:16` to Next's array form (light + dark entries); add `suppressHydrationWarning` to `<html>` at `:33`.
- `src/styles/globals.css` — add the `.dark` token block. **Also review every vendored component's inline `dark:` rules** — `base-nova` hard-codes per-component dark variants (e.g. `input` ships `dark:bg-input/30 dark:disabled:bg-input/80`; `button` outline ships `dark:border-input dark:bg-input/30 dark:hover:bg-input/50`); token remapping alone is not enough.
- **Proposed dark values** (starting point; `/design-review` confirms/tweaks — respects the doc's constraint that dark `--background` sits meaningfully below the `oklch(0.22 0.018 235)` sidebar):

  | token | light (current) | proposed dark |
  |---|---|---|
  | `--color-background` | `oklch(0.985 0.003 240)` | `oklch(0.16 0.012 240)` |
  | `--color-foreground` | `oklch(0.24 0.015 255)` | `oklch(0.92 0.010 245)` |
  | `--color-card` | `oklch(1 0 0)` | `oklch(0.20 0.013 240)` |
  | `--color-card-foreground` | `oklch(0.24 0.015 255)` | `oklch(0.92 0.010 245)` |
  | `--color-muted` | `oklch(0.955 0.006 240)` | `oklch(0.25 0.013 240)` |
  | `--color-muted-foreground` | `oklch(0.52 0.014 255)` | `oklch(0.66 0.014 250)` |
  | `--color-border` | `oklch(0.9 0.006 250)` | `oklch(0.30 0.010 245)` |
  | `--color-input` | `oklch(0.9 0.006 250)` | `oklch(0.30 0.010 245)` |
  | `--color-ring` | `oklch(0.52 0.09 175)` | `oklch(0.62 0.10 175)` |
  | `--color-primary` (brand) | `oklch(0.46 0.086 178)` | `oklch(0.62 0.10 178)` |
  | `--color-primary-foreground` | `oklch(0.99 0.005 180)` | `oklch(0.16 0.02 180)` |
  | `--color-accent` | `oklch(0.95 0.02 175)` | `oklch(0.28 0.04 178)` |
  | `--color-accent-foreground` | `oklch(0.35 0.07 178)` | `oklch(0.85 0.05 178)` |
  | `--color-positive` (inflow) | `oklch(0.55 0.11 165)` | `oklch(0.68 0.12 165)` |
  | `--color-positive-foreground` | `oklch(0.99 0.005 165)` | `oklch(0.16 0.02 165)` |
  | `--color-spend` | `oklch(0.52 0.14 32)` | `oklch(0.66 0.15 32)` |
  | `--color-spend-foreground` | `oklch(0.99 0.01 40)` | `oklch(0.16 0.02 32)` |
  | `--color-warning` | `oklch(0.72 0.13 75)` | `oklch(0.78 0.13 75)` |
  | `--color-sidebar` | `oklch(0.22 0.018 235)` | `oklch(0.22 0.018 235)` (unchanged) |
  | `--color-sidebar-foreground` | `oklch(0.9 0.01 240)` | `oklch(0.90 0.010 240)` (unchanged) |
  | `--color-sidebar-muted` | `oklch(0.62 0.015 240)` | `oklch(0.62 0.015 240)` (unchanged) |
  | `--color-sidebar-accent` | `oklch(0.4 0.07 178)` | `oklch(0.50 0.08 178)` |

### Success
**Automated**
- [x] `yarn typecheck` passes
- [x] `yarn run check` passes
- [x] `yarn build` passes (under `SKIP_ENV_VALIDATION=1`; local `.env` lacks `DEPLOYMENT_URL`, the pre-existing setup gap from Phase 9)
- [x] `git diff package.json` shows `next-themes` pinned (no `^`/`~`) — `next-themes@0.4.6`

**Manual**
- [x] `/design-review` — **no blockers.** Toggle light↔dark PASS across dashboard/forms/dialogs/lists; theme toggle SSR-safe; vendored `dark:` rules resolve against the new tokens. Fixed the one real gap: two priority badges (`Should Have`, `Fix`) were hardcoded light-only in `constants.ts` and glowed as near-white pills in dark → added `dark:` variants (light byte-identical, dark text/bg 9.3:1 / 7.8:1). Approved the dark token values with the review's two adjustments: badges fixed, and dark `--border`/`--input` lifted 0.30→0.40 for resting-state separation. Deferred as follow-ups: destructive Delete text/ring contrast (extends the tracked focus-ring follow-up), auth split-panel + primary-button character in dark (design calls), `themeColor` is OS-driven not toggle-driven (static-viewport limit), latent `--chart-*` dark parity.
  - **`/validate` (commit `84df016`):** whole-branch `/code-review` caught a dark active nav-link AA miss the live review couldn't (auth-DB blocked live QA) — the active pill (`bg-sidebar-accent` + `text-sidebar-foreground`) sat at ~4.3:1. Fixed: dark `--sidebar-accent` 0.5→0.46 (now ~5:1, still lifts off the rail). The badge `dark:` variants above were refactored into `--badge-info/-warn` tokens (`:root`+`.dark`, values unchanged) to kill the constants.ts↔globals.css drift (quality-control smell). `/quality-control`, `/code-comment` judge (5 PASS), `/security-review` (no findings) all clean.
- [x] No hydration warning on first paint — review confirmed zero console errors on clean loads; `.dark` class present at commit (next-themes blocking script + `suppressHydrationWarning`). `/validate` hardened parity: sonner `Toaster` theme gated behind a `mounted` flag (matches `ThemeToggle`) in `84df016`.

---

## Validation (whole branch)
- `/code-review` over the whole branch (standing `/validate` step — not repeated per phase).
- [x] **Phase 11 `/validate` (commit `84df016`):** gates green (`make check`/`build`/`test` 21/21; e2e no-op stub). `/code-review` → 5 findings triaged: dark nav-link contrast (fixed), sonner hydration guard (fixed), badge token drift (fixed); mobile toggle = Out of Scope; `themeColor` OS-driven = existing follow-up. `/quality-control`, `/code-comment` judge (5 PASS), `/security-review` (`src/lib/**` touched → run, no findings) all clean. ADR008/009 both Accepted, none left Proposed.

## References
- Design doc: `thoughts/designs/2026-08-11-shadcn-base-ui-migration.md` (carries `## Related ADRs`, `## Sequencing`, `## Verified 2026-08-11`)
- ADRs:
  - `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` (**Accepted**) — implemented by Phases 1–11 (init/style/path, Base UI not Radix, Select `null`, dialog/alert-dialog, visual verification, dark mode).
  - `docs/adr/adr009-react-hook-form-over-tanstack-form.md` (**Accepted**) — **no implementing phase in this plan, by design.** It is listed in the design doc's `## Related ADRs` but its own `## Out of scope` defers the form-state rewrite to a separate follow-up. Flag surfaced here per the ADR-mapping rule.
- Domain glossary: `CONTEXT.md` (money-direction / category vocabulary — "inflow", "spend").
- Constraint: `.claude/rules/package.json.md` — prod deps pinned, no `^`/`~`.
- Key code refs: `src/app/_components/ui/{primitives,modal,money}.tsx`, `src/styles/globals.css:3-40`, `src/lib/utils.ts:4`, `src/trpc/query-client.ts:7`, `src/app/layout.tsx:1,16,33`, `src/server/api/routers/transaction.ts:25` (follow-up only).

## Follow-ups this plan creates
- **react-hook-form (ADR009)** — pin `react-hook-form` 7.85.0 + `@hookform/resolvers` 5.7.1; wire `useForm`/`Controller` into the `field` family; unify the reset policy (2 forms use `key`, 2 use `useEffect`); errors → `FieldError`, mutation failures → Sonner (Sonner already wired in Phase 9). **Also unify the error channel:** Phase 9's global `MutationCache.onError` toast now double-reports on the 4 forms, which still set a local `onError` inline banner (`category-form.tsx:48` et al.) — the server error shows twice. Fix as part of the error-policy rework: client validation → inline, mutation/server failure → toast only (the delete flows already model this).
- **Destructive Delete button contrast in dark (design-review Phase 11, Medium ×2)** — two coupled issues on every `ConfirmDialog` Delete button: (1) focus ring is `ring-destructive/20`, faint against the dialog footer and below WCAG 1.4.11 (3:1); (2) in dark, `--destructive` is used as *both* text color and a 20% background fill, compositing to ~3:1 text contrast (AA needs 4.5:1). Fix together: give the destructive variant a solid, deliberately-contrasted treatment (opaque fill + foreground text) rather than the translucent self-tint, then a live contrast audit for the ring opacity.
- **Auth-DB env out-of-sync on `main` (blocks live QA)** — `/api/auth/*` returns HTTP 500 because the connected `main`/production Neon DB is missing/out-of-date on the better-auth `user`/`session` tables (domain-table tRPC queries succeed). Blocks live verification of Phase 9's dialogs/toasts. Sync the auth schema against the connected DB.
- **`category.ts` catch-all masks failures (design-review Medium)** — create/update wrap the DB call in `catch {}` and always throw `"A category with that name already exists."`; a timeout/lock now surfaces (via Phase 9's toast) as a misleading duplicate-name message. Narrow the catch to the unique-violation case.
- **Extract zod schemas** — `transactionInput` (`transaction.ts:25`) is inline/unexported; move to `*-schemas.ts` (the `*.schema.ts` suffix is reserved for Drizzle tables) so it is shareable client-side. Fixes the `Number(amount) || 0` coercion at the boundary.
- **`expense_category.name` uniqueness** — globally unique today; under planned `householdId` needs a composite constraint so two households can each have "Groceries".
- **Expense "Per" basis not persisted (Phase 7 design-review H4)** — the form derives all three amounts but stores no `basis` column, so editing an expense hard-resets "Per" to Month (`expense-form.tsx` inits `basis` to `"month"`, never reads `expense`). Editing the amount then silently mis-scales it. Needs a `basis` column + the react-hook-form reset-policy fix to round-trip.
- **Dark-mode resting border/input contrast (Phase 11 design-review, Medium)** — dark `--border`/`--input` lifted to `oklch(0.4 …)` (≈1.97:1 vs the card); WCAG 1.4.11 (3:1) needs ≈`0.50`, deliberately not taken to keep hairlines calm. Revisit if a stricter a11y bar lands.
- **Dark auth split-panel + primary-button character (Phase 11 design-review, Medium — design calls)** — on `/sign-in`,`/sign-up` the marketing (navy) and form (white) halves both collapse to near-black in dark, losing the intended light/dark tension; and dark `--primary` lifts to a light mint so primary buttons read *lighter* than their surroundings (opposite of light mode). Both pass contrast; they're aesthetic decisions to make deliberately.
- **`themeColor` is OS-driven, not toggle-driven (Phase 11 design-review, Nitpick)** — `layout.tsx` uses static `prefers-color-scheme` media queries, so a light-OS user toggled to dark still sees light-teal browser chrome. Closing it needs a client `useEffect` to rewrite the meta tag on theme change.
- **Latent `--chart-*` dark parity (Phase 11 design-review, Nitpick)** — `--chart-1..5` are identical in `:root` and `.dark` (grayscale placeholders). No consumer today (Recharts out of scope); needs real dark values when charts land.
