---
date: 2026-09-22
design: thoughts/designs/2026-09-22-client-traceparent.md
adrs: [adr018]
status: Ready to implement
---
# Client-originated traceparent Implementation Plan

## Context

On a live preview a developer opens `/receipts`, sees the `receipt.list` tRPC
call in DevTools, but there is no trace id to jump from that browser request to
its PostHog trace. The app instruments the server only (adr015), so every
request starts its own root trace. This work makes the browser mint a W3C
`traceparent` per request; Next already extracts it, so the server span parents
onto the client trace and client `trace_id` equals server `trace_id`, and the
tRPC route echoes the id back as `x-trace-id`.

## Current State

- Server-only observability: `@vercel/otel` registers `W3CTraceContextPropagator`
  and a `parentbased_always_on` sampler (`src/server/observability/otel.ts:48,51`).
  A sampled inbound parent is already honoured — no sampler change needed.
- tRPC client `headers` hook sets only `x-trpc-source`
  (`src/trpc/react.tsx:55-59`).
- Auth client is a bare `createAuthClient()` with no fetch hook
  (`src/server/auth/client.ts:3`).
- tRPC route calls `fetchRequestHandler` with no `responseMeta`
  (`src/app/api/trpc/[trpc]/route.ts:23-28`); no response carries a trace id.
- No `src/lib/traceparent.ts` exists; `src/lib/` holds pure helpers with
  colocated `.test.ts` (`src/lib/period.ts` + `src/lib/period.test.ts`).
- Reading the active span's trace id is an established pattern:
  `trace.getActiveSpan()?.spanContext()` (`src/server/observability/posthog.ts:31`,
  `src/server/observability/logger.ts:80`).
- `customFetchImpl` is a real better-auth client option, typed
  `customFetchImpl: FetchEsque` (`node_modules/better-auth/dist/client/config.d.mts:44`).

## Desired End State

- Every browser-controlled `/api/*` fetch — the tRPC batch POST and every
  better-auth call — carries a fresh, valid `traceparent` header with flags `01`.
- The server span tree for that request shares the browser's `trace_id`.
- The tRPC route response carries `x-trace-id` equal to the active span's trace
  id, so a developer reads it from the Network tab and searches PostHog with no
  backend round-trip.
- The uninstrumented paths (Blob `upload()` token call, `<img>`) are unchanged —
  they still start a fresh server root, as today.

## Out of Scope

- No browser OpenTelemetry SDK, no client spans, no OTLP exporter (adr018).
- Blob `upload()` token call and `<img src="/api/receipts/[id]/image">` — their
  SDKs / the browser expose no header hook. Left uninstrumented, by necessity.
- Webhook / inbound paths — server-originated, out of the browser's control.
- The `ParentBased` `remoteParentSampled` sampler fix in `otel.ts` — deferred
  until the preview echo proves the Vercel proxy strips the parent (adr018 risk).

## Approach

Build the pure minting helper first (Phase 1), then wire it into the two fetches
the browser controls (Phases 2–3), then add the server echo that verifies the
join (Phase 4). Each phase is a vertical slice with a colocated test written
TDD-style (one test → one impl → repeat, per the `tdd` skill). The echo in
Phase 4 doubles as the test for the design's one real unknown — whether the
Vercel proxy preserves the inbound parent — confirmed manually on preview.

## Phase 1: Minting helper

### Changes
- `src/lib/traceparent.ts` — new pure, dependency-free, isomorphic module:
  - `newTraceparent(): string` → `00-<32 hex>-<16 hex>-01`. Sixteen random bytes
    for the trace id, eight for the span id, both forced non-zero. Flags always
    `01`. Bytes from `crypto.getRandomValues`.
  - `traceIdOf(traceparent: string): string` → the bare 32-hex trace id (for logs).
- `src/lib/traceparent.test.ts` — colocated, mirrors `src/lib/period.test.ts`:
  - `newTraceparent` matches `/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/`.
  - trace id and span id are non-zero (never all-zero hex).
  - two calls return distinct trace ids (uniqueness).
  - `traceIdOf(newTraceparent())` returns the 32-hex trace-id segment.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `newTraceparent()` returns a W3C-valid, sampled, unique-per-call string
- [x] `/security-review` (touches `src/lib/**`)

## Phase 2: tRPC client header

### Changes
- `src/trpc/react.tsx` — in the `httpBatchStreamLink` `headers` hook
  (`src/trpc/react.tsx:55-59`), add `headers.set("traceparent", newTraceparent())`
  alongside the existing `x-trpc-source`. One fresh id per batch. Import from
  `~/lib/traceparent`.
- `src/trpc/react.test.tsx` — new colocated test: invoke the `headers` hook (or
  assert the header set on a built client) and assert it returns a header whose
  `traceparent` matches the valid format.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] the tRPC batch POST carries a valid `traceparent` header

## Phase 3: better-auth client header

### Changes
- `src/server/auth/client.ts` — pass `createAuthClient({ fetchOptions: {
  customFetchImpl } })` where `customFetchImpl` wraps global `fetch`, clones the
  request headers, injects a fresh `newTraceparent()`, then calls through. Keep
  the exported `authClient` / `Session` type. Type against `FetchEsque`
  (`node_modules/better-auth/dist/client/config.d.mts:44`).
- `src/server/auth/client.test.ts` — new colocated test: pass a fake inner
  `fetch` (recording call args), invoke `customFetchImpl`, assert (a) a valid
  `traceparent` header is present on the forwarded request and (b) the inner
  fetch is called through and its response returned unchanged.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] every better-auth fetch carries a valid `traceparent` and passes through untouched
- [x] `/security-review` (touches `**/auth/**`)

## Phase 4: Route echo (`x-trace-id`)

### Changes
- `src/app/api/trpc/[trpc]/route.ts` — add `responseMeta` to
  `fetchRequestHandler` (`route.ts:23-28`). Read
  `trace.getActiveSpan()?.spanContext().traceId` (pattern from
  `src/server/observability/posthog.ts:31`) and, when present, return
  `{ headers: { "x-trace-id": traceId } }`. Only server change; no other handler
  edits.
- `src/app/api/trpc/[trpc]/route.test.ts` — new colocated test, mocking pattern
  from `src/app/api/receipts/inbound/route.test.ts`:
  - with a fake active span set on the context (`trace.setSpan` / `context.with`),
    `responseMeta` returns `x-trace-id` equal to that span's `traceId`.
  - with no active span, `responseMeta` sets no `x-trace-id` header.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] the tRPC route response carries `x-trace-id` equal to the active span's trace id
- [ ] Preview verify: open `/receipts`; confirm the `traceparent` request header
      on the tRPC call, confirm the `x-trace-id` response header matches the sent
      trace id, and confirm PostHog shows the server span tree for that id
      (design §"Verify on preview")

## References
- Design doc: `thoughts/designs/2026-09-22-client-traceparent.md` (carries `## Related ADRs`)
- ADRs: `docs/adr/adr018-client-originated-traceparent.md` (Proposed) —
  implemented across Phases 1–4
- Related: `src/server/observability/otel.ts:48,51` (propagator + sampler,
  unchanged), `src/server/observability/posthog.ts:31` (active-span read pattern),
  `src/app/api/receipts/inbound/route.test.ts` (route-test mocking pattern),
  `src/lib/period.test.ts` (lib-test style), adr015 (server-only stance this refines),
  adr016 (how the trace id crosses the outbox into Inngest)
