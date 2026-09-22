# Client-originated traceparent

**Date**: 2026-09-22
**Status**: Design, validated. Ready for `/write-plan`.

## Problem

On a live preview, a developer opens `/receipts`, sees the tRPC `receipt.list`
call in DevTools, but finds no trace id on the request or response. There is no
way to jump from one browser request to its trace in PostHog.

Today the app instruments the server only (adr015). The browser sends no trace
context, so each server request starts its own root trace. The developer cannot
name the id from the client, and the server never hands it back.

## Goal

Every `/api/*` request the browser controls carries a client-generated trace id.
The id the browser mints becomes the PostHog `trace_id`, so a developer reads it
straight from the Network tab and searches PostHog with no backend round-trip.

## Decision

The browser mints a W3C `traceparent` per request and sends it. Next already
extracts inbound `traceparent` through the registered `W3CTraceContextPropagator`
(`node_modules/next/dist/server/lib/trace/tracer.js:152`, called from
`base-server.js:491`), so the server span becomes a child of the client's trace.
Client `trace_id` equals server `trace_id`, for free.

A hand-rolled helper mints the id. The app adds no browser OpenTelemetry SDK.

### Why not the OTel Web SDK

The minimal Web stack to inject `traceparent` on fetch costs ~30 KB gzip
(`sdk-trace-web` 13.1, `instrumentation-fetch` 5.5, `instrumentation` 2.1,
`core` 4.9, `api` 4.6). Shipping client spans adds the OTLP exporter and ~41 KB
of transitive deps. adr015 plans client-side work on PostHog, not OTel:
"feature flags, session replay and LLM evaluations are planned on it" (adr015
line 16). `posthog-js` (95 KB gzip) will own client telemetry later. A Web SDK
now would be a parallel stack the roadmap never asks for. The helper mints the
one string we need for ~0 KB using native `crypto.getRandomValues`.

### Granularity

One trace per HTTP request, not per procedure. `httpBatchStreamLink` collapses
many procedure calls into one POST, and one POST carries one `traceparent`. A
page load firing five queries becomes one trace with five child spans. This
matches the server, which runs one handler per POST. Per-procedure traces would
require dropping batching, which we reject.

## Scope

Two surfaces carry the header. The browser owns their fetch:

- **tRPC** — the `headers: () =>` hook in `src/trpc/react.tsx`.
- **better-auth** — `fetchOptions.customFetchImpl` in `src/server/auth/client.ts`.

Two surfaces stay uninstrumented, by necessity:

- **Blob `upload()` token call** — the `@vercel/blob/client` SDK owns that fetch
  and exposes no header hook. Low value: one token request. Left out.
- **`<img src="/api/receipts/[id]/image">`** — the browser sets no custom header
  on an `<img>`. Impossible. Left out.

Both fall back to a fresh server-side root trace, exactly as today.

## Components

### `src/lib/traceparent.ts` (new)

Pure, no dependencies, isomorphic (browser and Node 24).

- `newTraceparent(): string` returns `00-<32 hex>-<16 hex>-01`. Sixteen random
  bytes form the trace id, eight form the span id, both non-zero. Flags are `01`
  (sampled), always.
- `traceIdOf(traceparent: string): string` returns the bare 32-hex trace id for
  logs.
- `crypto.getRandomValues` supplies the bytes.

### `src/trpc/react.tsx` (edit)

The `headers` hook already sets `x-trpc-source`. Add one line:
`headers.set("traceparent", newTraceparent())`. Each batch mints a fresh id.

### `src/server/auth/client.ts` (edit)

Today a bare `createAuthClient()`. Add `fetchOptions.customFetchImpl` that wraps
global `fetch`, injects a fresh `traceparent` into the request headers, then
calls through.

### `src/app/api/trpc/[trpc]/route.ts` (edit)

Add `responseMeta` to `fetchRequestHandler`. Read
`trace.getActiveSpan()?.spanContext().traceId` and set `x-trace-id` when present.
This is the only server change.

The echo verifies the join. When the response `x-trace-id` equals the id the
browser sent, client and server share one trace. This is the design's one real
unknown, so the echo doubles as its test.

## What does not change

- **Parenting.** Next extracts the inbound `traceparent` and runs the handler in
  that context. The tRPC middleware span parents onto it. `member.id` baggage
  still stamps as today.
- **Sampler.** The client always sends flag `01`, so `parentbased_always_on`
  records the span. No custom `Sampler`.

## Risks

- **Vercel proxy.** Vercel's docs say inbound sampling is weighed against its own
  rules; the exact behaviour is unconfirmed. The `x-trace-id` echo tests it on
  preview: send a known id, check the response matches. If it ever fails, the fix
  is a `ParentBased` sampler forcing `remoteParentSampled` on, one line in
  `otel.ts`, deferred until proven needed.
- **Uninstrumented paths.** `<img>`, Blob token, and webhooks start their own
  root, as today. Expected.
- **Hostile client.** A crafted flag `00` suppresses the client's own span.
  Negligible for a private household app. No mitigation.

## Tests (colocated)

- `traceparent.test.ts` — format, non-zero, uniqueness.
- tRPC — `headers()` returns a valid `traceparent`.
- auth — `customFetchImpl` adds the header and passes the call through.
- route — `responseMeta` echoes the active span's trace id, with a fake active
  span.

## Verify on preview

1. Open `/receipts`. Confirm the `traceparent` request header on the tRPC call.
2. Confirm the `x-trace-id` response header matches the sent trace id.
3. Search PostHog for that trace id. Confirm the server span tree appears.

## Related ADRs

- [adr018](../../docs/adr/adr018-client-originated-traceparent.md) — Mint the
  trace id in the browser as a W3C `traceparent`; no OTel Web SDK. (Proposed)
