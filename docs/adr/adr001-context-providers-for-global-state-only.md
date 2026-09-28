---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-10'
# prettier-ignore
---

# Context Providers are reserved for genuinely global state

## Context and Problem Statement

React Context Providers widen the read/write surface of a piece of state to their entire subtree. State that is actually local to one page or modal becomes accessible — and mutable — by anything underneath that subtree, coupling the owning component to consumers it cannot see. Context also forces a `"use client"` boundary, which pulls otherwise-static Server Component subtrees into the client bundle. The React docs explicitly order the alternatives: pass props → extract components and pass `children` → only then consider Context.

This codebase is unusually exposed to the temptation. The dashboard is a set of filter-and-table screens — `src/app/(dashboard)/transactions/_components/transactions-view.tsx` alone is 339 lines carrying search, category filter, sort and pagination state, with a modal form beside it. "Lift the filters into a `TransactionFilterProvider` so the table and the toolbar can both reach them" is the exact move this rule exists to pre-empt.

When does React Context appropriately model state in this codebase?

## Decision Drivers

- **Context widens the read/write surface to the entire subtree.** State scoped to one page or modal becomes reachable — and mutable — by anything underneath the provider. The component that owns the state can no longer reason about who depends on it.
- **Server Component boundaries should stay narrow.** Every Context Provider forces a `"use client"` boundary at its root; the Next.js docs recommend mounting providers as deep as possible so static parts of Server Components remain optimisable.
- **React's prescribed ordering is props → children → Context.** Skipping that ordering for ergonomic reasons is the recurring source of unnecessary providers. The rule should reinforce the ordering, not subvert it.
- **A simple, code-review-enforceable rule beats a lint rule today.** There are zero React `createContext` calls in `src/` as of 2026-08-10; investing in custom tooling now is premature. Biome is the only linter configured (`biome.jsonc`) and has no custom-rule facility comparable to an ESLint plugin.

## Considered Options

1. Context only for genuinely global state; inline `useState` in the owning component for page/modal-local state with named props down
2. Compound-component carve-out as general policy — Context permitted as a private implementation detail of a single composable component (e.g. internal `<Tabs>` plumbing)
3. Lint rule banning `createContext` outside an allowlist

## Decision Outcome

Chosen option: "1. Context only for genuinely global state; inline `useState` in the owning component for page/modal-local state with named props down", because it is the only option that holds the line on Context's read/write-widening cost without either licensing a recurring abuse vector (option 2) or building tooling for a problem that does not exist yet (option 3).

### Implementation status

The codebase already conforms — this ADR records the rule going forward, it does not describe a refactor. A scan of `src/` on 2026-08-10 finds zero React `createContext` and zero `useContext` calls. The three `createContext` matches (`src/app/api/trpc/[trpc]/route.ts:12`, `src/trpc/server.ts:15`, and the doc comment at `src/server/api/root.ts:25`) are tRPC **server**-context factories, unrelated to React Context.

### Positive Consequences

- **Server Component boundaries stay narrow.** Context Providers force a `"use client"` boundary; lifting state to a client component and passing props down is App-Router-native. Per the Next.js docs, providers should be rendered as deep as possible in the tree so static parts of Server Components remain optimisable.
- **The filter-and-table screens keep their state where it is owned.** `transactions-view.tsx`, `expenses-view.tsx` and `income-view.tsx` each own their filter and modal state outright; a future reader can see every consumer at the prop boundary rather than searching for `useContext` calls.
- **A genuine compound-component need triggers a follow-up ADR.** No silent exceptions — amend this rule explicitly when a real case appears, rather than relying on case-by-case judgement that drifts toward the page-local Context the rule exists to prevent.

### Negative Consequences

- **Conformance is enforced by code review, not by tooling.** Future changes that introduce a `createContext` outside the allowlist are caught in review. If drift becomes frequent, revisit option 3.
- **Prop-threading cost grows with screen complexity.** `transactions-view.tsx` is already 339 lines; as filter state grows, the named-prop lists grow with it. The escape hatch is to extract child *components* and pass `children`, not to reach for Context.

## Applying the Rule

### What counts as "genuinely global"

- Auth session (cross-route identity)
- Theme / appearance
- Feature flags
- API / transport clients (tRPC, React Query `QueryClient`)
- Routing (provided by the framework)

### What does NOT count, regardless of how convenient Context feels

- Form state (the expense / income / transaction forms, multi-step or otherwise)
- Filter, search, sort, pagination and selection state — "what's showing on this screen"
- Open/close state for a single modal
- Anything whose lifetime is bounded by a single page or modal

### Current allowlist

| File                                       | Concern                                 | Justification                          |
| ------------------------------------------ | --------------------------------------- | -------------------------------------- |
| `src/trpc/react.tsx` (`TRPCReactProvider`) | tRPC client + React Query `QueryClient` | API/transport client. Mounted at root in `src/app/layout.tsx`. |

That is the entire list. This app has no theme provider (colours are Tailwind v4 `@theme` tokens in `src/styles/globals.css`), no analytics provider, and no feature-flag provider.

### The pattern when the temptation arises

Inline `useState` directly in the owning component — no extracted custom hook (a custom hook is callable by any component anywhere, which invites someone to instantiate "the modal's state" outside the modal). Children receive exact named props (`value: string; onChange: (s: string) => void`), never a fat `state` object. Default to `useState`; escalate to `useReducer` only when state has real transitions (named actions, "reset all", inter-field invariants) — and inline the reducer too. When in doubt, follow the React docs ordering: pass props → extract components and pass `children` → only then consider Context.

## Pros and Cons of the Options

### 1. Context only for genuinely global state; inline `useState` for page/modal-local state with named props

The owning component holds `useState`; children receive exact named props. Context is reserved for cross-route concerns and an allowlisted set of transport/theme/flag providers.

| Pros                                                                                                            | Cons                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Owning component retains full read/write control of its state; consumers are explicit at the prop boundary       | Conformance relies on code review, not on automated tooling                                                  |
| Server Component subtrees stay static — `"use client"` boundaries are pushed as deep as the React docs recommend | Extending the allowlist requires writing a follow-up ADR rather than adding the new provider opportunistically |
| Matches React docs' prescribed ordering (props → children → Context)                                            | Named-prop lists grow as a screen's filter state grows                                                        |
| No custom tooling to maintain; the rule fits in a one-line reference from `.claude/rules/frontend.md`            |                                                                                                              |

### 2. Compound-component carve-out as general policy

Permit Context as a private implementation detail of a single composable component (the canonical `<Tabs>` / `<Accordion>` plumbing pattern). Treats compound-component Context as categorically acceptable rather than requiring a per-case ADR.

- Bad, because "private implementation detail" tends to be invoked to justify the next page-local Context. The label is too easy to claim and too hard to falsify in review.
- Bad, because a categorical carve-out replaces a one-line rule with a judgement call on every change — exactly the drift the rule is trying to prevent.
- Good, because when a genuine compound-component case appears, the pattern is well-understood and the per-case follow-up ADR is straightforward to write. Deferring to that path costs little. The hand-rolled primitives in `src/components/ui/` are the likely first candidates.

### 3. Lint rule banning `createContext` outside an allowlist

Encode the allowlist in a lint rule that fails CI when `createContext` is added in a file outside the allowed paths.

- Bad, because there is no offending code today. Building tooling for a problem that has not appeared is premature; the simple rule plus code review is enough until drift is observed.
- Bad, because this project lints with Biome, which has no custom-rule authoring story equivalent to a local ESLint plugin — the rule would mean adopting a second linter purely to enforce an allowlist of one entry.
- Good, because if drift does appear, the allowlist in this ADR doubles as the spec for the future rule.

## Links

- Enforced by: `.claude/rules/frontend.md` — the one-line rule that cites this ADR
- React docs: https://react.dev/learn/passing-data-deeply-with-context
- Next.js docs: https://nextjs.org/docs/app/getting-started/server-and-client-components
