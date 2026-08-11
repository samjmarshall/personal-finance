---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-11'
# prettier-ignore
---

# Use react-hook-form, not @tanstack/react-form, for form state

Design: [2026-08-11 Install shadcn/ui on Base UI and migrate the hand-rolled components](../../thoughts/designs/2026-08-11-shadcn-base-ui-migration.md)

## Context and Problem Statement

The four forms — category, expense, income, transaction — currently manage state with raw `useState` and hand-rolled submit handlers. They have drifted: two reset on edit via a `key` on the parent, two via `useEffect` from props; two surface mutation errors in a bespoke inline `<p>`, and two swallow failures silently. `Number(amount) || 0` coerces typos to `0` in all four. Adopting a form library is the agreed follow-up to [adr008](adr008-shadcn-on-base-ui-for-shared-primitives.md), which lands the library-agnostic `field` family the forms will bind to.

The project already runs `@tanstack/react-query`, so `@tanstack/react-form` is the obvious guess, and shadcn documents both against `field` — its integration no longer favours either. Which form library do we bind these four forms to?

## Decision Drivers

- **Community adoption.** An explicit project criterion, weighed on real download and star counts rather than impressions.
- **Existing familiarity.** The sole maintainer has three years of react-hook-form; ramp-up on an unfamiliar API is real cost on a pre-PMF prototype.
- **Fit to the actual forms.** These hold five to seven flat fields each. Features that only pay off on deeply nested forms are not features here.
- **Bundle cost.** Client-side weight on a form-heavy app.
- **Ecosystem overlap.** The project already has tRPC and TanStack Query; a library that duplicates their responsibilities adds surface without adding capability.

## Considered Options

1. **react-hook-form** with `@hookform/resolvers` for zod v4.
2. **@tanstack/react-form**, matching the existing TanStack Query dependency.

## Decision Outcome

Chosen option: **1, react-hook-form**, because it wins the adoption driver by 23× while tying on bundle size once the resolver counts, and TanStack Form's genuine advantages — server-action primitives and deep path inference — do not apply to five-to-seven-field flat forms in a tRPC app.

The counter-argument worth recording: sharing a vendor with TanStack Query is a *coherence* argument, not a *capability* one. The two libraries share no runtime, no state, and no API surface; the only thing gained is a matching name in `package.json`.

### Positive Consequences

- Zero ramp-up. The maintainer writes these forms from memory, which matters more than any listed feature at this stage.
- Overwhelming ecosystem: 58.2M weekly downloads, 44.8k stars, 74% usage in State of React 2025 — every question already has an answer.
- One shared policy becomes cheap to apply across all four forms: field validation to `FieldError`, mutation failure to a Sonner toast, killing both the reset-strategy and error-handling drift in one pass.
- `Number(amount) || 0` gets fixed properly, by a zod schema at the boundary rather than a coercion in the handler.

### Negative Consequences

- Needs `@hookform/resolvers` (5.7.1) to consume zod v4 schemas. TanStack Form takes a Standard Schema directly, so this is one extra pinned dependency and one extra import per form.
- Two vendors for adjacent concerns. Someone will re-propose TanStack Form on coherence grounds within six months; this record is the answer.
- The zod schemas must be extracted before they can be shared client-side — `transactionInput` is inline and unexported at `transaction.ts:25`. That is follow-up work this decision creates.

## Pros and Cons of the Options

Figures retrieved live on 2026-08-11.

### 1. react-hook-form

| Adoption | Maturity | Bundle (gzip) | Fit |
| --- | --- | --- | --- |
| 58.2M weekly downloads, 44,819 stars, 74% State of React 2025 usage | v7 since 2021; v7.85.0 released 2026-08-08; 1 open issue | 17.4 kB + 4.9 kB resolver = **22.3 kB** | Three years of maintainer experience; flat forms are its core case |

- Good, because adoption — an explicit criterion — is 23× TanStack Form's.
- Good, because the maintainer already knows it, so the follow-up is mechanical rather than exploratory.
- Bad, because zod v4 needs `@hookform/resolvers` rather than working directly.

### 2. @tanstack/react-form

| Adoption | Maturity | Bundle (gzip) | Fit |
| --- | --- | --- | --- |
| 2.5M weekly downloads, 6,646 stars, 21% State of React 2025 usage (up 8 places) | 1.0 on 2025-03-02; v1.33.4; 111 open issues | **22.1 kB**, no resolver | Server-action primitives overlap tRPC; deep path inference wasted on flat forms |

- Good, because it shares a vendor with the existing `@tanstack/react-query`.
- Good, because it consumes zod v4 schemas directly through Standard Schema, with no resolver package.
- Good, because it is growing fast and shadcn documents it against `field` as a first-class option.
- Bad, because its differentiating features — server-action primitives, deep path inference — are inert here: tRPC already owns the mutation path, and the forms are flat.
- Bad, because the bundle advantage disappears once react-hook-form's resolver is counted (22.1 kB vs 22.3 kB).
- Bad, because it loses the adoption driver decisively, and adds an unfamiliar API on a prototype with one maintainer.

## Links

- Refines [adr008](adr008-shadcn-on-base-ui-for-shared-primitives.md) — the `field` family these forms bind to
- Vendor docs: [shadcn field + react-hook-form](https://ui.shadcn.com/docs/components/field)
