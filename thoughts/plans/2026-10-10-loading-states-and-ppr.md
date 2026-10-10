---
date: 2026-10-10
design: thoughts/designs/2026-10-02-loading-states-and-ppr.md
adrs: [adr026, adr027]
status: Ready for Review - Phase 2 of 7
---
# Loading states and Partial Prerendering Implementation Plan

## Context

Pages load data on the server and show nothing until it arrives. There is no `loading.tsx`, no route-level `<Suspense>` and no skeleton or spinner. Buttons show pending work in four different ways, and some show nothing. This plan streams every data region behind `AsyncBoundary` with a skeleton and gives every action a pending state (Stage A, phases 1–6). Phase 7 (Stage B) then turns on `cacheComponents`, so the nav and skeletons ship in a prerendered static shell (PPR).

## Current State

- **Versions.** `next` is 16.4.0 (`package.json:69`), not the 16.3.5 the design names. React 19.2.8 (`:72-73`), `@base-ui/react` 1.7.0 (`:47`), better-auth 1.6.26 (`:60`), `tw-animate-css` 1.4.0 (`:82`), Vitest 4.1.11 (`:101`).
- **Auth.**
  - `src/app/(dashboard)/layout.tsx:11-14` awaits `getSession()`, redirects to `/sign-in` and passes `userName` to `AppNav` / `MobileNav` (`:18`, `:20`).
  - `getSession` is `cache(() => auth.api.getSession({ headers: await headers() }))` (`src/server/auth/server.ts:5-7`).
  - There is no `src/proxy.ts` or `middleware.ts`.
  - The session cookie is better-auth's default `better-auth.session_token`, `__Secure-` prefixed on https (`src/server/auth/config.ts` sets no `cookiePrefix`). `cookieCache` lasts 60s (`config.ts:66`).
  - `getSessionCookie(request)` checks both names and only checks that the cookie is there (`node_modules/better-auth/dist/cookies/index.mjs:211-219`).
  - `protectedProcedure` throws `UNAUTHORIZED` at `src/server/api/trpc.ts:189-191`.
  - Sign-in and sign-up await `getSession()` and redirect signed-in Members (`src/app/sign-in/page.tsx:8-9`, `src/app/sign-up/page.tsx:8-9`).
- **Nav.** `src/components/app-nav.tsx` is `"use client"` (`:1`).
  - `AppNav({ userName })` is at `:178`. Its member block is at `:192-197`, the Settings link at `:200-205` and `<SignOutButton />` at `:206`.
  - `SignOutButton` is a private raw `<button>` (`:136-176`).
  - `MobileNav({ userName })` is at `:212`. It renders the name only as an unlabelled `sr-only` span (`:227`).
- **tRPC RSC helpers.**
  - `src/trpc/server.ts:16-27`: `createContext` reads `headers()`, so every caller call and prefetch is a runtime read.
  - `caller = createCaller(createContext)` with no `onError` (`:30`). `api` and `HydrateClient` come from `createHydrationHelpers` (`:32-35`).
  - A caller's `onError` runs before the rethrow, so an error thrown inside it propagates instead (`node_modules/@trpc/server/dist/tracked-DWInO6EQ.mjs:315-324`).
- **Query client** (`src/trpc/query-client.ts:31-55`).
  - The `MutationCache` toasts every mutation error (`:36-38`). There is no `QueryCache`.
  - No `retry` is set, so client queries retry 3 times.
  - Pending queries are dehydrated (`:47-49`).
  - No `shouldRedactErrors` is set. TanStack's default redacts every rejected pending query to `Error("redacted")` (`@tanstack/query-core/build/modern/hydration.js:15-29,56-58`), which drops Next's `NEXT_REDIRECT` digest. adr026's open question comes from this.
- **Error boundaries.**
  - `catchError` (`next/error`) is client-only.
  - It rethrows `redirect()` / `notFound()` (`node_modules/next/dist/client/components/catch-error.js:53-58`).
  - Its `retry()` runs `context.refresh()` from `AppRouterContext` then `reset()` in a transition (`:39-47`).
  - The fallback is called as `fallback(props, { error, reset, retry })`.
- **Loading UI today.**
  - The only `<Suspense>` is `src/app/(dashboard)/_components/cash-flow-chart.tsx:75-79`.
  - The only route `error.tsx` is `src/app/(dashboard)/expenses/unplanned/error.tsx`.
  - There is no `Skeleton` or `Spinner` in `src/components/ui/`.
  - There are nine ad-hoc `Loader2Icon` / `Loader2` spinners: `sonner.tsx:28`, `receipt-upload.tsx:103`, `receipt-detail.tsx:177,224-226,321`, `more-details.tsx:114,125`, `balance-snapshot-card.tsx:99-100`, `pay-cycle-section.tsx:76-77` and `allowed-senders-section.tsx:101-102`.
- **Dashboard home** (`src/app/(dashboard)/page.tsx`).
  - It awaits `transaction.summary`, `expense.list` and `income.list` (`:20-25`), then starts the `cashflow.get` / `balance.latest` prefetches (`:29-30`).
  - Stat cards: derived at `:32-80`, rendered at `:90-117`.
  - Cash flow + balance grid: `:119-130`.
  - Spend charts (monthly, priority, top groups): `:132-182`.
- **List pages.**
  - Each `page.tsx` calls `void api.*.prefetch()` and wraps its view in `HydrateClient`. There is no boundary. Every view renders its own `PageHeader` (`src/components/page-header.tsx:3-27`).
  - `/expenses`, `/income`, `/expenses/categories`: `useSuspenseQuery` only.
  - `/transactions`: `transaction.list.useQuery` with `placeholderData`. Filters are in `useState` (`transactions-view.tsx:57-84`), and `isFetching` dims the rows (`:250-254`).
  - `/receipts`:
    - `receipt.list.useQuery` with `placeholderData` and 3s polling while a row is pending (`receipts-view.tsx:85-97`).
    - The page prefetches the list without input (`receipts/page.tsx:5`), so the key misses the client's `{ unmatchedOnly: false }`. This is Bug 1.
  - `/expenses/unplanned`: `transaction.unplanned.useQuery` waits on `skipToken` until an effect sets `range` (`unplanned-view.tsx:53-72`). It has its own loading card (`:271-282`) and error card (`:179-197`).
  - `/settings`:
    - `SettingsView` has no query.
    - The pay-cycle panel (`pay-cycle-section.tsx:15`) and the allowed-senders panel (`allowed-senders-section.tsx:20`) suspend.
    - The page reads `env.RESEND_INBOUND_ADDRESS` (`settings/page.tsx:12`).
- **Receipt bugs.**
  - Bug 2: `receipt-detail.tsx:315` treats `!data` as loading, so a failed `receipt.get` spins forever.
  - Bug 3: `:149` and `:276-279` toast in `onError`, on top of the global toast.
  - The design's Bug 4 (categories `useState(list)` copy) was already fixed in commit `6ea0b35`. `categories-view.tsx:23` reads the query directly.
- **Actions.**
  - `ConfirmDialog`'s action is `AlertDialogAction`, built on `Close`, so it closes on click (`src/components/confirm-dialog.tsx:47-52`, `src/components/ui/alert-dialog.tsx:145-162`). Six delete call sites use it.
  - Forms swap their label to "Saving…" and never lock their fields.
  - `FieldSet` renders a native `<fieldset>` (`src/components/ui/field.tsx:9-20`), but Base UI `Select.Trigger` / `Combobox.Input` ignore a disabled ancestor fieldset (`@base-ui/react/select/trigger/SelectTrigger.js:75`, `combobox/input/ComboboxInput.js:81`).
  - Dialog `onOpenChange(open, eventDetails)` gives `eventDetails.cancel()` (`@base-ui/react/dialog/root/DialogRoot.d.ts:40,85-88`).
  - An AlertDialog never dismisses on outside press (`dialog/root/useRenderDialogRoot.js:29-30`).
  - Base UI `Button` has `focusableWhenDisabled` (`button/Button.d.ts:17-21`).
  - `SortableItem` accepts `disabled` (`src/components/ui/sortable.tsx:303-327`).
- **Tests and lint.**
  - `vitest.config.ts:3-18` runs `src/**/*.test.ts` in node. No jsdom or Testing Library is installed, and there are no `.test.tsx` files.
  - `.claude/rules/unit-testing.md:1-20` only covers `.test.ts`.
  - `biome.jsonc` has no `noRestrictedImports` or `overrides`. The rule sits in the `style` group (`node_modules/@biomejs/biome/configuration_schema.json:14085,14271`).
- **Stage B blockers.**
  - `next.config.ts:4-35` has no `cacheComponents`. 16.4 also expects `partialPrefetching: true` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md:21-29`).
  - `src/app/api/health/route.ts:10` exports `dynamic = "force-dynamic"`, which errors under `cacheComponents` (`02-guides/migrating-to-cache-components.md:74`).
  - TanStack `prefetchQuery` and `dehydrate()` read `Date.now()` (`hydration.js:32`), which is a sync-IO prerender error unless `await io()` runs first (`03-api-reference/04-functions/io.md`).
  - No server component reads `new Date()` in render. The client `new Date()` reads (`expenses-view.tsx:101`, `one-time-section.tsx:43`, form `useState` initialisers) all sit inside data boundaries.

## Desired End State

- Signed out, `curl -I https://personal-finance.localhost/expenses` returns 307 to `/sign-in`. `/sign-in` and `/sign-up` never redirect on cookie presence.
- With a stale cookie, every dashboard route lands on `/sign-in` with no "Couldn't load" card, on both a hard load and a client navigation.
- Every data region renders through `AsyncBoundary`:
  - a skeleton of the real height
  - a hidden "Loading {label}" status
  - a fade-in that respects reduced motion
  - a per-section "Couldn't load {label}" card whose Try again recovers
- Biome rejects `Suspense` from `react` and `catchError` from `next/error` outside `src/components/async-boundary.tsx`.
- The dashboard home shows its header at once and fills three sections on their own. All five tRPC calls start together.
- Filter changes on transactions, receipts and unplanned dim the rows and never flash a skeleton.
- Bugs 1–3 are fixed.
- Every action shows a spinner on its own button with the label kept. Forms lock while saving. Delete dialogs stay open until the delete is done.
- `cacheComponents` is on. `make build` passes with no `instant = false`, and each dashboard route's raw HTML contains the nav and skeleton markup.

## Out of Scope

- Optimistic UI for mutations.
- Moving list filters into URL search params.
- Playwright e2e setup.
- Mobile layout and nav redesign, including mobile sign-out. `MobileNav` drops its unlabelled `sr-only` name; the redesign owns the mobile member area.
- Nav pending UI: `useLinkStatus`, a top progress bar, and `use cache: private` on `NavMember`. These are follow-ups after Stage B.
- A browser error SDK (adr020). Client-only render errors stay uncaptured.
- Design Bug 4. It was already fixed in `6ea0b35`.

## Approach

Ship seven PRs in the design's delivery order. The design's slice 4 is split in two (phases 4 and 5), and the confirm-dialog change moves into the action phase (6), because callers must close the dialog in the same PR that stops it auto-closing.

- Phase 1 lands the primitives, `AsyncBoundary` and the Biome ban, with jsdom tests.
- Phases 2–5 move auth and each route behind boundaries.
- Phase 6 adds pending states.
- Phase 7 flips `cacheComponents` and fixes the known prerender errors.

Each phase leaves the app working and passes `make check`, `make test` and `make build`. `make build` needs production env vars (`docs/README.md:39`).

Run every phase on a feature branch. Check that `make db_branch_status` shows `*` on `local/<branch>` before any write or session test.

## Phase 1: Test setup and shared building blocks

### Changes

- `package.json`: add dev dependencies `@testing-library/react`, `@testing-library/user-event` and `jsdom`. Ranges are allowed for dev deps (`.claude/rules/package.json.md`).
- `vitest.config.ts:3-18`: split into `test.projects`, each with `extends: true` so `env`, `unstubEnvs` and `tsconfigPaths` still apply.
  - `node` project: `src/**/*.test.ts`.
  - `jsdom` project: `src/**/*.test.tsx`, with `setupFiles: ["src/test/setup-dom.ts"]`.
- `src/test/setup-dom.ts`: `afterEach(cleanup)` from Testing Library. Vitest globals are off, so its auto-cleanup won't register.
- `src/test/app-router.tsx`: a test wrapper that provides `AppRouterContext` (`next/dist/shared/lib/app-router-context.shared-runtime`) with a `refresh` spy, because `catchError`'s `retry()` calls `context.refresh()` (`catch-error.js:39-47`).
- `.claude/rules/unit-testing.md:1-20`:
  - Add `src/**/*.test.tsx` to `paths`.
  - Allow colocated `.test.tsx`.
  - Limit component tests to shared components in `src/components/`.
  - Test behaviour (states, aria, callbacks, open/close), never styling.
- `src/components/ui/skeleton.tsx`: new, from the shadcn registry. `data-slot="skeleton"`, `animate-pulse rounded-md bg-muted`, `aria-hidden`, `motion-reduce:animate-none`.
- `src/components/ui/spinner.tsx`: new, from the shadcn registry. A decorative `Loader2Icon` with `animate-spin motion-reduce:animate-none` and `aria-hidden`. Callers that need an announcement wrap it in a `role="status"` region.
- `src/components/ui/button.tsx:43-56`: add a `loading?: boolean` prop.
  - Text sizes: render `<Spinner data-icon="inline-start" />` before the label and keep the label.
  - Icon sizes (`icon`, `icon-xs`, `icon-sm`, `icon-lg`, `:22-33`): swap the icon child for a same-size `Spinner`.
  - When loading, set `disabled`, `focusableWhenDisabled` and `aria-busy`.
- `src/components/ui/button.test.tsx`: `loading` shows a spinner, sets `aria-busy`, ignores clicks, and keeps focus on the button.
- `src/components/skeletons.tsx`: new.
  - `TableSkeleton({ rows, cols })`, `CardSkeleton` and `ChartSkeleton({ height })`.
  - Each uses real row and card heights so content lands without layout shift.
- `src/components/async-boundary.tsx`: new, `"use client"`. Implements `docs/adr/adr027-async-boundary-for-loading-regions.md` (this phase implements that decision).
  - Props: `skeleton: ReactNode | null`, `label: string`, `fade?: boolean` (default `true`), `children`.
  - Pending:
    - `<Suspense>` fallback renders `skeleton` in a region with `aria-busy`, plus a visually hidden `role="status"` reading "Loading {label}".
    - With `skeleton={null}`, render nothing.
  - Resolved:
    - Fade in (`animate-in fade-in motion-reduce:animate-none`) only if the fallback rendered for this mount.
    - Content that mounts without suspending (cached data) does not fade.
    - Server streaming must fade when the server rendered the fallback.
    - Hydration must not warn.
  - Error:
    - `catchError` is called at module scope. Its fallback function returns an `AsyncBoundaryError` component; hooks live there, not in the fallback function.
    - `AsyncBoundaryError` logs `console.error(error)`, as `expenses/unplanned/error.tsx:22-24` does.
    - It renders a card reading "Couldn't load {label}" with **Try again**.
    - Try again calls `useQueryErrorResetBoundary().reset()`, then `retry()`. Never `catchError`'s `reset()`.
    - With `skeleton={null}`, it renders `null` but still logs.
- `src/components/async-boundary.test.tsx`, wrapped in `src/test/app-router.tsx`, tests these behaviours (TDD vertical slices, one at a time):
  1. Pending shows the skeleton and "Loading {label}" status text.
  2. Resolved shows the content.
  3. It fades only after the fallback showed. A cached mount has no fade class.
  4. An error shows the card. With `skeleton={null}` it shows nothing.
  5. Try again calls the router `refresh` spy and re-renders the content once the child stops throwing.
  6. `redirect("/sign-in")` thrown by a child reaches an outer test boundary with a `NEXT_REDIRECT` digest.
- `biome.jsonc:33-47`:
  - Add `linter.rules.style.noRestrictedImports` with `paths`: `react` → `importNames: ["Suspense"]` and `next/error` → `importNames: ["catchError"]`. Both messages say "Use AsyncBoundary (src/components/async-boundary.tsx)".
  - Add a top-level `overrides` entry that turns the rule off for `src/components/async-boundary.tsx`.
- `src/app/(dashboard)/_components/cash-flow-chart.tsx:3,73-80`: replace the hand-written `<Suspense>` with `<AsyncBoundary label="cash flow chart" skeleton={<ChartSkeleton height={312} />}>` around `CashFlowChartBody`. 312px is today's `h-72` chart (288) plus its legend row (24); 288 alone shifts the page 24px. A period change still reloads only the chart.

### Success

- [x] `make check` passes
- [x] `make test` passes, and both the `node` and `jsdom` projects run
- [x] `make build` passes
- [x] Adding `import { Suspense } from "react"` to any other file fails `make check` with the `AsyncBoundary` message
- [x] On `/`, switching the cash-flow period to Month shows the `ChartSkeleton`, then the chart. With reduced motion on, it neither pulses nor fades.
- [x] `/design-review`

## Phase 2: Auth gate

### Changes

This phase implements `docs/adr/adr026-optimistic-proxy-auth-gate.md`.

- `src/lib/auth-redirect.ts`: new, pure `authRedirect(pathname: string, hasCookie: boolean): string | null`.
  - It returns `"/sign-in"` when there is no cookie and the path is not `/sign-in` or `/sign-up`. Otherwise it returns `null`.
  - It never redirects the auth pages on cookie presence. That would loop on an expired cookie.
- `src/lib/auth-redirect.test.ts` (node):
  - no cookie on `/` and `/expenses` → `/sign-in`
  - cookie present → `null`
  - no cookie on `/sign-in` and `/sign-up` → `null`
- `src/proxy.ts`: new.
  - `export function proxy(request: NextRequest)` redirects with `NextResponse.redirect(new URL(to, request.url))` when `authRedirect(request.nextUrl.pathname, getSessionCookie(request) !== null)` returns a path. Otherwise it returns `NextResponse.next()`.
  - `config.matcher` is `"/((?!api|sign-in|sign-up|_next/static|_next/image|.*\\..*).*)"`.
- `src/trpc/auth-errors.ts`: new.
  - `redirectOnUnauthorized({ error })` calls `redirect("/sign-in")` when `error.code === "UNAUTHORIZED"`.
  - `isAuthError(error: unknown)` is true for a `TRPCClientError` with `data.code === "UNAUTHORIZED"`, or an error whose `digest` starts with `NEXT_REDIRECT`.
- `src/trpc/auth-errors.test.ts` (node):
  - `UNAUTHORIZED` throws a `NEXT_REDIRECT` error to `/sign-in`; other codes don't throw.
  - `isAuthError` recognises both shapes and rejects a plain `Error`.
- `src/trpc/server.ts:30`: `createCaller(createContext, { onError: redirectOnUnauthorized })`. tRPC rethrows what `onError` throws (`tracked-DWInO6EQ.mjs:315-324`), and `catchError` passes the redirect through.
- `src/trpc/query-client.ts:31-55`. Together these resolve adr026's open question:
  - Add `queryCache: new QueryCache({ onError })`. In the browser it sends a `TRPCClientError` `UNAUTHORIZED` to `window.location.assign("/sign-in")`.
  - Set `defaultOptions.queries.retry` to `(failureCount, error) => !isServer && failureCount < 3 && !isAuthError(error)`. This keeps TanStack's server default of 0, and stops 3 backed-off retries (about 7s) before an auth redirect.
  - Set `dehydrate.shouldRedactErrors: () => false`, as the tRPC docs do. A rejected prefetch then reaches the client with its `NEXT_REDIRECT` digest. Flight still strips messages in production.
- `src/components/sign-out-button.tsx`: new. Move `SignOutButton` out of `app-nav.tsx:136-176` unchanged and export it.
- `src/components/nav-member.tsx`: new server component.
  - `NavMember` awaits `getSession()` and calls `redirect("/sign-in")` when it returns nothing.
  - It renders the "Signed in as" block (moved from `app-nav.tsx:192-197`) and `<SignOutButton />`.
  - `NavMemberSkeleton` has the same height.
- `src/components/app-nav.tsx:178-230`:
  - `AppNav` takes `member: ReactNode` instead of `userName`. The footer renders the Settings link, then `member`.
  - `MobileNav` drops `userName` and the `sr-only` span (`:227`).
- `src/app/(dashboard)/layout.tsx:1-25`:
  - Make it a sync layout with no `getSession()`.
  - Render `<AppNav member={<AsyncBoundary label="member" skeleton={<NavMemberSkeleton />}><NavMember /></AsyncBoundary>} />` and `<MobileNav />`.
- `src/components/redirect-if-signed-in.tsx`: new server component. It awaits `getSession()`, redirects to `/` when signed in, and otherwise returns `null`.
- `src/app/sign-in/page.tsx:1-19`, `src/app/sign-up/page.tsx:1-19`:
  - Make each a sync page with no `getSession()`.
  - Render `AuthShell` + `AuthForm`, plus `<AsyncBoundary label="session" skeleton={null}><RedirectIfSignedIn /></AsyncBoundary>`.
- `docs/adr/adr026-optimistic-proxy-auth-gate.md`: record the answer under "Open Questions":
  - Redaction is off, so the redirect digest survives.
  - Auth errors aren't retried.
  - `NavMember` stays the backstop.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes
- [x] Signed out, `curl -I https://personal-finance.localhost/expenses` returns 307 to `/sign-in`, and `curl -I https://personal-finance.localhost/sign-in` returns 200
- [x] On the `local/<branch>` database, delete a session you created (its row and Redis key), then wait out the 60s `cookieCache`. Every dashboard route then lands on `/sign-in` with no "Couldn't load" card, on both a hard load and a client navigation.
- [x] A signed-in Member who opens `/sign-in` lands on `/`
- [x] The desktop nav paints at once; the member block shows its skeleton, then the name and Sign out
- [x] `/design-review`
- [x] `/security-review`

## Phase 3: Dashboard home

### Changes

- `src/app/(dashboard)/_components/overview-data.ts`: new, `import "server-only"`. `getSummary`, `getExpenses` and `getIncome` are each `cache(() => api.<proc>())`, so sibling sections share one call.
- `src/app/(dashboard)/_components/stat-cards.tsx`: new.
  - Async `StatCards` awaits the three getters. It moves the derivation from `page.tsx:32-80` and the grid from `:90-117`.
  - `StatCardsSkeleton` uses the same four-card grid and card height.
- `src/app/(dashboard)/_components/cash-flow-section.tsx`: new.
  - `CashFlowSection` starts the two prefetches from `page.tsx:29-30` and renders the grid from `:119-130` inside `HydrateClient`.
  - `CashFlowSectionSkeleton` pairs a `ChartSkeleton` with a `CardSkeleton` in the same grid.
- `src/app/(dashboard)/_components/spend-charts.tsx`: new.
  - Async `SpendCharts` awaits `getSummary()` and moves `page.tsx:132-182`, including the `Net` line.
  - `SpendChartsSkeleton` keeps the same grid.
- `src/app/(dashboard)/page.tsx:20-185`: a sync page.
  - It keeps `PageHeader` and renders three `AsyncBoundary`s in today's order: `label="summary"` around `StatCards`, `label="cash flow"` around `CashFlowSection`, and `label="spending"` around `SpendCharts`.
  - `HydrateClient` moves into `CashFlowSection`.
- No new tests. These are single-use route components (design decision 13).

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] With dev latency on, a hard load of `/` paints the header and three skeletons at once, and each section fills on its own with no layout shift
- [ ] Server logs show `transaction.summary`, `expense.list`, `income.list`, `cashflow.get` and `balance.latest` all start in the same request window, not after one another
- [ ] Forcing `transaction.summary` to throw shows "Couldn't load summary" and "Couldn't load spending" while cash flow still renders. Removing the fault and pressing Try again recovers.
- [ ] `/design-review`

## Phase 4: Prefetched pages, settings and safety nets

### Changes

- `src/components/page-skeleton.tsx`: new. `PageSkeleton({ title, description, action, children })`:
  - It renders the real `PageHeader` with `title` and `description`, a button-sized `Skeleton` in `actions` when `action` is true, and `children` (default `<TableSkeleton />`).
  - It uses the views' page container, so content lands without shift.
- `src/app/(dashboard)/expenses/page.tsx:4-13`, `income/page.tsx:4-11` and `expenses/categories/page.tsx:4-12` follow the design's page pattern:
  - The sync page renders `<AsyncBoundary fade={false} label="…" skeleton={<PageSkeleton … />}>` around an async `*Data` child.
  - The `*Data` child holds today's `void prefetch()` calls and `HydrateClient`.
  - Labels are "expenses", "income" and "categories". The skeleton title and description match each view's `PageHeader` (`expenses-view.tsx:200-209`, `income-view.tsx:113-122`, `categories-view.tsx:96-105`).
- `src/app/(dashboard)/settings/page.tsx:5-14`: the same pattern with `label="settings"`. `SettingsData` reads `env.RESEND_INBOUND_ADDRESS` and prefetches.
- `src/app/(dashboard)/settings/_components/settings-view.tsx:29-50`: wrap the pay-cycle and forwarding panels each in `<AsyncBoundary label="pay cycle" | "allowed senders" skeleton={<CardSkeleton />}>`. Appearance needs no boundary.
- `src/app/(dashboard)/loading.tsx`: new. A generic `PageSkeleton` with a title `Skeleton`, kept as a safety net.
- `src/app/(dashboard)/error.tsx`: new client safety net.
  - It takes `{ error, retry }` and logs `console.error(error)`.
  - It renders a `role="alert"` card reading "Couldn't load this page" with Try again calling `retry()`, modelled on `expenses/unplanned/error.tsx:12-46`.
- No new tests (single-use route components).

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] A hard load of `/expenses`, `/income`, `/expenses/categories` and `/settings` paints the title and skeleton at once, then content with no layout shift and no header blink
- [ ] A nav click to each of those routes shows its skeleton at once
- [ ] On `/settings`, Appearance renders while the other panels load. Forcing `allowedSender.list` to throw shows the card only in that panel.
- [ ] Screen readers announce "Loading expenses" (and so on) while pending
- [ ] `/design-review`

## Phase 5: Filtered lists and receipt bugs

### Changes

- `src/app/(dashboard)/transactions/page.tsx:4-17`, `receipts/page.tsx:4-11` and `expenses/unplanned/page.tsx:4-14` follow the Phase 4 page pattern. Labels are "transactions", "receipts" and "unplanned Spend".
- `src/app/(dashboard)/receipts/page.tsx:5`: prefetch `receipt.list` with `{ unmatchedOnly: false }` (Bug 1).
- `src/app/(dashboard)/transactions/_components/transactions-view.tsx:72-100,250-254`:
  - Build `queryInput` with `useMemo` over the filter state, so it changes only when a filter changes.
  - Pass it through `useDeferredValue`. Call `transaction.list.useSuspenseQuery(deferredInput)` and drop `placeholderData`.
  - Dim the `<tbody>` (`opacity-60`) while `queryInput !== deferredInput`, replacing the `isFetching` dim.
  - Read `data.items` / `data.total` directly.
- `src/app/(dashboard)/receipts/_components/receipts-view.tsx:85-107,153-157,263-274`:
  - Apply the same `useMemo` + `useDeferredValue` + `useSuspenseQuery` change and keep `refetchInterval` polling.
  - Drop the `isError` copy (`:264-267`); `AsyncBoundary` owns errors.
- `src/app/(dashboard)/expenses/unplanned/_components/unplanned-table.tsx`: new.
  - `UnplannedTable({ range })` calls `transaction.unplanned.useSuspenseQuery({ from, to })` and renders the grouped rows and empty state moved from `unplanned-view.tsx:198-296`, including the link picker.
- `src/app/(dashboard)/expenses/unplanned/_components/unplanned-view.tsx:53-72,119,179-204,271-282`:
  - Keep the `range` effect. Defer `range` with `useDeferredValue`.
  - While `range` is `null`, render `<TableSkeleton />`.
  - Otherwise render `<AsyncBoundary fade={false} label="unplanned Spend" skeleton={<TableSkeleton />}><UnplannedTable range={deferredRange} /></AsyncBoundary>`, dimmed while `range !== deferredRange`.
  - This inner boundary stops the table's first load from re-suspending the whole page.
  - Remove the loading card, error card and `isFetching` dim.
- `src/app/(dashboard)/expenses/unplanned/error.tsx`: delete. `AsyncBoundary` replaces it.
- `src/app/(dashboard)/receipts/_components/receipt-detail.tsx:315-322`: Bug 2.
  - Render a `role="alert"` "Couldn't load this receipt" state with Try again (`refetch()`) when `receipt.get` errors.
  - Show the spinner only while it is loading.
- `src/app/(dashboard)/receipts/_components/receipt-detail.tsx:149,276-279`: Bug 3. Drop the local `onError` toasts; `query-client.ts:36-38` already toasts.
- No new tests (single-use route components).

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] Changing search, sort, page or a filter on `/transactions` and `/receipts` dims the rows and never flashes a skeleton
- [ ] Stepping the period on `/expenses/unplanned` dims the rows. The first load shows one `TableSkeleton` under the real header and period controls, with no full-page skeleton flash.
- [ ] A first load of `/receipts` with receipts in the database shows rows, never "No receipts yet" (Bug 1)
- [ ] A stale-session client nav to `/receipts` lands on `/sign-in` with no "No receipts yet" flash
- [ ] With a pending receipt, `/receipts` still polls every 3s
- [ ] Forcing `receipt.get` to throw shows the error state with Try again, not an endless spinner (Bug 2)
- [ ] A failed confirm-match or item attribution shows exactly one toast (Bug 3)
- [ ] `/design-review`

## Phase 6: Action pending states

### Changes

- `src/components/confirm-dialog.tsx:17-55`: add a `pending?: boolean` prop.
  - The action becomes a plain `Button` with `loading={pending}`. It is no longer `AlertDialogAction`, which closes on click.
  - Cancel gets `disabled={pending}`.
  - `onOpenChange` calls `eventDetails.cancel()` while pending, which blocks Esc.
  - The caller closes the dialog on success.
- `src/components/delete-confirm-dialog.tsx:8-19`: pass `pending` through.
- `src/components/confirm-dialog.test.tsx` (jsdom):
  - While `pending`, the dialog stays open on Esc and Cancel, and the action shows `aria-busy`.
  - A harness whose `onConfirm` resolves closes the dialog.
  - A harness whose `onConfirm` rejects leaves it open.
- The six delete callers pass `pending={remove.isPending}` and close on success with `remove.mutate({ id }, { onSuccess: () => setConfirmOpen(false) })`:
  - `receipts-view.tsx:282`
  - `allowed-senders-section.tsx:162`
  - `expenses-view.tsx:426`
  - `categories-view.tsx:194`
  - `income-view.tsx:262`
  - `transactions-view.tsx:384`
- Dialog forms:
  - Files: `expense-form.tsx:109,173,312-316`, `category-form.tsx:47,64,111-113`, `income-form.tsx:87,141,284-285` and `transaction-form.tsx:90,151,282-284`.
  - Wrap the fields in `<FieldSet disabled={isSaving}>`.
  - Also pass `disabled={isSaving}` to each `SelectField` / `Combobox`, because Base UI ignores the native fieldset.
  - Cancel gets `disabled={isSaving}`.
  - Submit stays outside the fieldset with `loading={isSaving}` and keeps its label (drop "Saving…").
  - The dialog's `onOpenChange` calls `eventDetails.cancel()` while saving, which blocks Esc, outside press and the X.
- `src/components/auth-form.tsx:18-44,86-94`:
  - Wrap the fields in `<FieldSet disabled={loading}>`. Submit uses `loading` and stays loading through the route change; `loading` already isn't reset on success (`:38-39`).
  - The error `<p>` gets `role="alert"`.
- `src/components/sign-out-button.tsx`: a `Button` with `loading` replaces the raw `<button>`, keeping the nav item look.
- Single buttons switch the `Loader2Icon` swap to `loading` and get their labels back:
  - `balance-snapshot-card.tsx:90-106`
  - `pay-cycle-section.tsx:70-83`
  - `allowed-senders-section.tsx:95-108` (icon-only, so it shows a same-size spinner)
- Row actions show `loading` only on the acting row (`mutation.variables?.id === row.id`):
  - `receipts-view.tsx:224-237`: retry becomes an icon `Button` with `loading`.
  - `unplanned-table.tsx` (the link picker moved in Phase 5): a `Spinner` beside the acting row's picker.
  - `receipt-detail.tsx:434-468`: a `Spinner` beside the acting item's pickers.
  - `receipt-detail.tsx:202-227`: confirm match uses `loading` on the acting row.
- `src/app/(dashboard)/expenses/categories/_components/categories-view.tsx:108-127`: pass `disabled={reorder.isPending}` to each `SortableItem` (`sortable.tsx:303-327`) so the drag handles lock while the save runs.
- `src/app/(dashboard)/receipts/_components/receipt-upload.tsx:95-110`: `loading={status !== "idle"}`, keeping the "Processing…" / "Uploading…" stage labels.
- These switch to `Spinner`: `receipt-detail.tsx:170-180,315-322`, `more-details.tsx:114,125` and `src/components/ui/sonner.tsx:28`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] Each delete keeps its dialog open with a spinner until done. It closes on success, and on error it stays open and the global toast reports it.
- [ ] Each dialog form locks inputs, selects, comboboxes and Cancel while saving, ignores Esc and the X, and shows a spinner beside the kept label
- [ ] Sign-in shows a spinner until the dashboard renders, and screen readers announce a sign-in error
- [ ] Balance save, pay-cycle save, allowed-sender add, receipt retry, confirm match, the item and link pickers, upload and sign out each show a spinner on the acting control only
- [ ] Drag handles lock while a category reorder saves
- [ ] `Loader2Icon` / `Loader2` appear in `src/` only inside `src/components/ui/spinner.tsx`
- [ ] `/design-review`

## Phase 7: Stage B, enable PPR

### Changes

- `next.config.ts:4-35`: set `cacheComponents: true` and `partialPrefetching: true` (`cacheComponents.md:21-29`).
- Add `await io()` (from `next/cache`) as the first line of every prefetching server section:
  - Files: `expenses/page.tsx`, `income/page.tsx`, `expenses/categories/page.tsx`, `settings/page.tsx`, `transactions/page.tsx`, `receipts/page.tsx`, `expenses/unplanned/page.tsx` (their `*Data` children) and `_components/cash-flow-section.tsx`.
  - Why: TanStack `prefetchQuery` / `dehydrate()` read `Date.now()` before `headers()` is awaited, which is a sync-IO prerender error (`hydration.js:32`, `migrating-to-cache-components.md:101`, `io.md`).
- `src/app/api/health/route.ts:7-10`:
  - Remove `export const dynamic = "force-dynamic"`, which errors under `cacheComponents` (`migrating-to-cache-components.md:74`).
  - Call `await connection()` (from `next/server`) first in `GET`, so `select 1` runs per request and never at build (`:825-829`).
- Run `make build` and fix any other validation error it reports.
  - `export const instant = false` is a last resort only. Mark each use with a `TODO` and remove it before merging.
- Keep `src/app/(dashboard)/loading.tsx`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes with no validation errors, and `rg "instant = false" src` finds nothing
- [ ] The `make build` route table marks `/`, `/expenses`, `/income`, `/expenses/categories`, `/transactions`, `/receipts`, `/expenses/unplanned`, `/settings`, `/sign-in` and `/sign-up` as Partial Prerender
- [ ] Against a production build served locally, the raw HTML of each dashboard route, fetched with any session cookie, contains the nav (`aria-label="Main navigation"`) and `data-slot="skeleton"` markup
- [ ] `curl -I https://personal-finance.localhost/api/health` returns 200 and the database is hit per request
- [ ] The Phase 2 signed-out and stale-cookie checks still pass
- [ ] `/design-review`
- [ ] `/security-review`

## References

- Design doc: `thoughts/designs/2026-10-02-loading-states-and-ppr.md` (carries `## Related ADRs`)
- ADRs:
  - `docs/adr/adr027-async-boundary-for-loading-regions.md` (Accepted), implemented by Phase 1
  - `docs/adr/adr026-optimistic-proxy-auth-gate.md` (Accepted), implemented by Phase 2, which also resolves its open question
- Composes with: adr001 (`QueryClient` as a global client), adr006 (session cache), adr008 (shadcn on Base UI), adr020 (no browser SDK), adr021 (RSC caller)
- Next 16.4 docs, under `node_modules/next/dist/docs/01-app/`:
  - `03-api-reference/04-functions/catchError.md`
  - `03-api-reference/04-functions/io.md`
  - `03-api-reference/03-file-conventions/proxy.md`
  - `03-api-reference/03-file-conventions/loading.md:86-93`
  - `03-api-reference/05-config/01-next-config-js/cacheComponents.md`
  - `02-guides/migrating-to-cache-components.md`
  - `02-guides/authentication-with-cache-components.md`
- Related code:
  - `src/trpc/server.ts:16-35`
  - `src/trpc/query-client.ts:31-55`
  - `src/server/api/trpc.ts:75-81,184-199`
  - `src/components/app-nav.tsx:136-230`
- Prior fix: commit `6ea0b35` (categories cache read, the design's Bug 4)
