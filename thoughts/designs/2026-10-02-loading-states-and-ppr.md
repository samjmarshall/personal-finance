# Loading states and Partial Prerendering

Date: 2026-10-02
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr001 (providers), adr006 (session cache), adr008 (shadcn on Base UI), adr021 (RSC caller), adr026 (proxy auth gate), adr027 (`AsyncBoundary`)

## Problem

Pages load data on the server and show nothing until it arrives. The app has no
`loading.tsx`, no route-level `<Suspense>`, no skeleton or spinner primitives, and
one `error.tsx`. Buttons signal pending work four different ways, and some not at all.

- `/` awaits three tRPC calls, then starts two more: a waterfall that blocks first paint.
- Other pages prefetch, but their `useSuspenseQuery` views have no boundary. A hard
  load waits for every query; a client navigation leaves the old page frozen.
- `(dashboard)/layout.tsx` awaits `getSession()` at the top, which blocks the whole tree.
- All six deletes close their dialog at once and give no feedback.

Goal: stream every data region behind a `<Suspense>` boundary with a skeleton, give
every action a pending state, then enable `cacheComponents` so the nav and skeletons
ship in a prerendered static shell (PPR).

PPR speeds up first paint and navigation. It does not make data arrive sooner.

## Verified facts

- Next 16.3.5, React 19.2.8, tRPC 11.18 classic `@trpc/react-query`
  (`createHydrationHelpers`), TanStack Query 5.101, `@base-ui/react` 1.7.0, Vitest 4.1.
- Next 16 removed `experimental.ppr`; `cacheComponents: true` enables PPR. With it on,
  a runtime read (`headers()`, `cookies()`, uncached data) outside `<Suspense>` fails
  the build. `loading.tsx` does not cover runtime reads in its own layout
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:88-93`).
- `src/trpc/query-client.ts` already dehydrates pending queries, so `void prefetch()` streams.
- `src/trpc/server.ts` `createContext` reads `headers()`, so every prefetch is a runtime read.
- `catchError` (`next/error`) builds a component-level error boundary. It passes
  `redirect()`/`notFound()` through, `retry()` re-renders in a Transition, and it
  clears on navigation.
- TanStack suspense errors need `useQueryErrorResetBoundary().reset()` before a retry refetches.
- better-auth exports `getSessionCookie` from `better-auth/cookies`, a cookie-presence check that skips the database.
- Base UI `Button` supports `focusableWhenDisabled`.
- `PageHeader` renders inside seven client views, and view `useState` drives its
  `actions`. Only `(dashboard)/page.tsx` renders it on the server.
- Dev adds 100–500ms latency per tRPC call (`src/server/api/trpc.ts:75-81`), so loading states show locally.

## Decisions

1. **Stage the work.** Stage A adds boundaries, skeletons and pending states with
   `cacheComponents` off. Stage B turns it on and fixes build validation.
2. **Gate auth in `src/proxy.ts`; check the real session later.** Proxy redirects
   dashboard routes to `/sign-in` when the session cookie is missing. `protectedProcedure`
   and `<NavMember>` validate the session itself.
3. **Use one boundary per section, not per card.** The dashboard gets three, settings
   one per data panel, and each list page one.
4. **Keep the dashboard home as RSC.** Async server sections await inside their own boundary.
5. **Filtered lists use `useSuspenseQuery` + `useDeferredValue`.** Filters stay in `useState`.
6. **`Button` gains a `loading` prop.** It keeps the label, adds a spinner and sets `aria-busy`.
7. **Deletes keep the confirm dialog open until done.** No optimistic UI.
8. **`<AsyncBoundary>` pairs a `catchError` boundary with `<Suspense>`.** Pages never write `<Suspense>` by hand.
9. **Use a small shared skeleton set** with pulse, fade-in and reduced-motion support.
10. **Add no nav pending UI.** `loading.tsx` and PPR cover it; see Optional follow-ups.
11. **Lock forms while saving** with the existing `FieldSet`.
12. **Fix bugs 1–4 here.** Mobile sign-out waits for the mobile redesign.
13. **Test shared components' behaviour in jsdom.** Skip single-use components and styling.

## Shared building blocks

New primitives in `src/components/ui/` (shadcn only):

- **`Skeleton`**: `animate-pulse rounded-md bg-muted`, `aria-hidden`, `motion-reduce:animate-none`.
- **`Spinner`**: replaces the ~10 ad-hoc `Loader2Icon animate-spin`.
- **`Button` `loading` prop** (`src/components/ui/button.tsx`): `Spinner` at
  `data-icon="inline-start"`, label kept; icon-only sizes swap the icon for a
  same-size spinner. Sets `disabled`, `focusableWhenDisabled` and `aria-busy`.

New shared components in `src/components/`:

- **`AsyncBoundary`** (`skeleton`, `label`, optional `fade`, default `true`):
  - Wraps `<Suspense>` in a `catchError` boundary.
  - Pending: renders `skeleton`, plus a visually hidden `role="status"` reading
    "Loading {label}", with `aria-busy` on the region.
  - Resolved: renders the content, fading it in with `tw-animate-css` (off under reduced motion).
    It fades only if the skeleton actually showed: the fallback sets a flag in
    `AsyncBoundary`, and content that mounts without suspending (cached data) skips the fade.
  - Error: renders a card reading "Couldn't load {label}" with a **Try again** button
    that calls TanStack `useQueryErrorResetBoundary().reset()`, then `catchError`'s
    `retry()` (not its `reset()`, which skips the refetch). Only that section fails.
  - `skeleton={null}` is allowed for invisible gates such as `RedirectIfSignedIn`.
    An invisible gate also fails invisibly: with `skeleton={null}` the error fallback
    renders `null` (still logged), so a session-read outage never puts an error card
    above the sign-in form. `NavMember` keeps the normal card.
  - The error fallback logs `console.error(error)`, as `unplanned/error.tsx` does, so the
    digest matches server logs. Server failures are already captured (`onRequestError`,
    tRPC `observabilityMiddleware`). Client-only render errors stay uncaptured: there is
    no browser SDK (adr020). Out of scope.
- **`TableSkeleton`** (`rows`, `cols`), **`CardSkeleton`**, **`ChartSkeleton`** (`height`).
  Each uses real heights so content lands without layout shift. Unique shapes, such
  as the dashboard stat cards, live in their route's `_components/`.
- **`ConfirmDialog` / `DeleteConfirmDialog`** gain a `pending` prop. The action
  button stops auto-closing (`AlertDialogAction` is built on `Close`), shows `loading`,
  and the caller closes the dialog on success. On error the dialog stays open and the
  global toast reports it.

Rule: a page adds a loading region only through `<AsyncBoundary>`. Biome enforces it:
`noRestrictedImports` bans `Suspense` from `react` and `catchError` from `next/error`,
and a top-level `overrides` entry lifts the ban for `src/components/async-boundary.tsx`.
The message points to `AsyncBoundary`. `cash-flow-chart.tsx:75`, the one hand-written
`<Suspense>` today, moves to `AsyncBoundary` with a `ChartSkeleton`.

## Auth and app shell

- **`src/proxy.ts`** matches dashboard routes and excludes `/sign-in`, `/sign-up`,
  `/api` and static assets. A pure `authRedirect(pathname, hasCookie)` holds the rule.
  Proxy never redirects the auth pages on cookie presence; that would loop on an expired cookie.
- **`(dashboard)/layout.tsx`** stops awaiting the session and renders `AppNav` /
  `MobileNav` immediately. The member area becomes
  `<AsyncBoundary skeleton={<NavMemberSkeleton/>} label="member"><NavMember/></AsyncBoundary>`,
  passed into the client nav as a slot prop instead of the `userName` string.
- **`NavMember`** (server) calls `getSession()`, redirects to `/sign-in` on an invalid
  session, and renders the name and `SignOutButton`.
- **Stale cookie** (cookie present, session gone, e.g. signed out on another device):
  the Member goes straight to `/sign-in` and never sees "Couldn't load" cards.
  - Server: the RSC caller (`src/trpc/server.ts`) maps `UNAUTHORIZED` to
    `redirect("/sign-in")`; `catchError` passes the redirect through.
  - Client: the `QueryCache` `onError` in `src/trpc/query-client.ts` sends
    `UNAUTHORIZED` to `/sign-in`.
  - Verify: a pending prefetch that rejects streams to the client as a dehydrated
    error, which TanStack may redact. Confirm the redirect still fires on that path;
    if it does not, `NavMember`'s redirect is the backstop.
- **Sign-in / sign-up** render `AuthShell` + `AuthForm` immediately. A
  `<RedirectIfSignedIn/>` inside `<AsyncBoundary skeleton={null}>` sends signed-in Members to `/`.

## Page pattern

```tsx
export default function ExpensesPage() {
	return (
		<AsyncBoundary skeleton={<ExpensesSkeleton />} label="expenses" fade={false}>
			<ExpensesData />
		</AsyncBoundary>
	);
}

async function ExpensesData() {
	void api.expense.list.prefetch();
	void api.expense.consumption.prefetch();
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
```

Prefetches move from the page body into a child inside the boundary, because they
read `headers()`.

The page skeleton renders the real `PageHeader` (title and description) with
`Skeleton` placeholders for its actions, above a `TableSkeleton`. The fallback lives
in the static shell, so the title paints at once without refactoring views. Page-level
boundaries set `fade={false}` so the header does not blink when the view replaces it.

## Per route

| Route | Boundaries | Changes |
|---|---|---|
| `/` | 3 | `PageHeader` stays in `page.tsx`. `<StatCards>` and `<SpendCharts>` are async server sections. `cache()` wrappers (`getSummary`, etc.) dedupe shared calls. Sibling boundaries render concurrently, so all five calls start together. The cash-flow + balance section prefetches as today. The chart's inner boundary becomes `AsyncBoundary` + `ChartSkeleton`, so a period change reloads only the chart. |
| `/expenses`, `/income`, `/expenses/categories` | 1 | Page skeleton = `PageHeader` + `TableSkeleton`. |
| `/transactions`, `/receipts`, `/expenses/unplanned` | 1 | `useQuery` → `useSuspenseQuery`. Query input passes through `useDeferredValue`; while `input !== deferredInput` the table dims (`opacity-60`) instead of showing a skeleton. Receipts keeps polling. Unplanned keeps its client-side date range: `useSuspenseQuery` takes no `skipToken`, so a child `UnplannedTable range={range}` renders only once the effect sets `range`, and the view shows the same `TableSkeleton` until then. |
| `/settings` | 1 page + 1 per data panel | Appearance needs no data. Pay cycle and allowed senders each get an `AsyncBoundary` inside `SettingsView`. |
| `/sign-in`, `/sign-up` | 1 (no skeleton) | `RedirectIfSignedIn`. |

Add `(dashboard)/loading.tsx` (generic skeleton) and `(dashboard)/error.tsx` as safety
nets. `AsyncBoundary` replaces `expenses/unplanned/error.tsx`.

## Action pending states

- **Dialog forms** (expense, category, income, transaction) and `AuthForm`: fields
  sit in `<FieldSet disabled={isPending}>`, which locks inputs, selects and Cancel.
  Submit uses `loading`. The dialog ignores Esc and outside clicks while pending.
  Check that Base UI Select and Combobox triggers honour a native disabled fieldset.
- **Auth**: the sign-in button stays `loading` through the route change, and the
  error `<p>` gets `role="alert"`. `SignOutButton` uses `loading`.
- **Single buttons**: balance save, pay-cycle save and allowed-sender add switch to
  `loading`; their labels return.
- **Row actions**: receipt retry, the unplanned link picker and the receipt item
  pickers show `loading` on the acting row only (`mutation.variables?.id === row.id`).
- **Deletes**: all six pass `pending` to the confirm dialog.
- **Category reorder**: drag handles lock while the save runs.
- **Receipt upload, confirm match, receipt detail**: switch to `Spinner` / `loading`.

## Bugs fixed in scope

1. `receipts/page.tsx` prefetches `receipt.list` without input, but the client asks
   for `{ unmatchedOnly: false }`. The keys differ, so the first load shows a false
   "No receipts yet". Prefetch the client's default input.
2. `receipt-detail.tsx:315` treats `!data` as loading, so a failed `receipt.get`
   spins forever. Render an error state.
3. `receipt-detail.tsx:149,278` toast in `onError`, and so does the global handler.
   Drop the local toasts.
4. `categories-view.tsx:29` copies the query into `useState(list)` once, so add, edit
   and delete never appear. Re-sync from the query; the optimistic order lives only
   until the reorder settles.

Out of scope: mobile nav lacks sign-out. The mobile layout redesign will fix it.

## Stage B: enable PPR

- Set `cacheComponents: true` in `next.config.ts`.
- Run `make build` and fix each validation error. Expect `new Date()` / `Date.now()`
  in render and any `headers()` read left outside a boundary.
- `export const instant = false` is a temporary escape hatch only. Mark each use with
  a TODO and aim to ship with none.
- Keep `(dashboard)/loading.tsx`.

## Testing

Add `@testing-library/react`, `@testing-library/user-event` and `jsdom`. Split
`vitest.config.ts` into `projects`: node for `src/**/*.test.ts`, jsdom for
`src/**/*.test.tsx`. Update `.claude/rules/unit-testing.md`: allow `.test.tsx`, and
limit component tests to shared components in `src/components/`, testing behaviour
(states, aria, callbacks, open/close) and never styling.

| Component | Behaviour under test |
|---|---|
| `Button` | `loading` shows a spinner, sets `aria-busy`, ignores clicks, keeps focus |
| `AsyncBoundary` | Pending shows skeleton + status text; resolved shows content; fades only after a fallback showed; error shows the card (none when `skeleton={null}`); Try again re-fetches; `redirect()` passes through |
| `ConfirmDialog` / `DeleteConfirmDialog` | Stays open while `pending`; closes on success; stays open on error |

`authRedirect` gets a node `.test.ts`. Skeletons and `Spinner` get no tests.

## Delivery order

1. Test infrastructure, shared building blocks and their tests, and the Biome ban.
   The ban fails on `cash-flow-chart.tsx:75`, so this slice also moves that boundary.
2. Auth gate: `proxy.ts`, `NavMember`, `RedirectIfSignedIn`.
3. Dashboard home.
4. List pages, settings and bugs 1–4.
5. Action pending states.
6. Stage B: `cacheComponents`.

Slices 3–5 depend on 1. Slice 6 depends on 2–4.

## Verification

- Every PR passes `make check`, `make test` and `make build`.
- Signed out, `curl -I https://personal-finance.localhost/expenses` returns 307 to `/sign-in`.
- With a stale cookie (delete the session row and its Redis key, then wait out the
  60s `cookieCache`), every dashboard route redirects to `/sign-in` and shows no
  "Couldn't load" card.
- `/design-review` across routes, with the dev latency on:
  - A hard load shows skeletons, then content, with no layout shift.
  - A nav click shows the target skeleton at once.
  - A filter change dims rows and never flashes a skeleton.
  - A forced procedure error shows the error card, and Try again recovers.
  - Reduced motion stops the pulse and fade.
  - Screen readers announce "Loading …".
- After Stage B, the raw HTML of each route contains the nav and skeleton markup.

## Optional follow-ups (after Stage B)

The user wants to try these once PPR ships:

- `useLinkStatus` spinner on side-nav links, delayed ~100ms.
- A top progress bar, e.g. `vercel/react-transition-progress`.
- `use cache: private` on `NavMember` so prefetched shells carry the name. This needs
  a `stale` time of at least 5 minutes, but better-auth's cookie cache lasts 60s, so
  check the fit first.

## Out of scope

- Optimistic UI for mutations.
- Moving list filters into URL search params.
- Playwright e2e setup.
- Mobile layout and navigation redesign.

## Sources

- Next 16.3.5 local docs: `02-guides/authentication-with-cache-components.md`,
  `02-guides/migrating-to-cache-components.md`, `02-guides/instant-navigation.md`,
  `03-api-reference/04-functions/catchError.md`, `03-api-reference/03-file-conventions/loading.md`.
- [tRPC: TanStack React Query server components](https://trpc.io/docs/client/tanstack-react-query/server-components)
- [React `<Suspense>`](https://react.dev/reference/react/Suspense): 300ms reveal throttle, boundary granularity.
- [NN/g skeleton screens](https://www.nngroup.com/articles/skeleton-screens/), [NN/g progress indicators](https://www.nngroup.com/articles/progress-indicators/).
- [Primer loading pattern](https://primer.style/product/ui-patterns/loading/), [Adrian Roselli: more accessible skeletons](https://adrianroselli.com/2020/11/more-accessible-skeletons.html).
- [web.dev CLS](https://web.dev/articles/optimize-cls).

## Related ADRs

- [adr026](../../docs/adr/adr026-optimistic-proxy-auth-gate.md): gate dashboard routes on cookie presence in `proxy.ts`; validate the session inside Suspense.
- [adr027](../../docs/adr/adr027-async-boundary-for-loading-regions.md): add every loading region through `AsyncBoundary` (`catchError` + `<Suspense>`), enforced by Biome.
