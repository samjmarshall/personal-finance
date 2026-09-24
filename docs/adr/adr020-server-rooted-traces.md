---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-24'
# prettier-ignore
---

# Root every trace at the first server span; the browser sends no `traceparent`

Technical Story: [2026-09-15 PostHog observability plan](../../thoughts/plans/2026-09-15-posthog-observability.md) — validation, D4

## Context

[adr018](adr018-client-originated-traceparent.md) had the browser mint a W3C `traceparent` per request so the server span parented onto a client trace, and the developer read the id from the request header in the Network tab. The browser never exported a span for that parent — adr018 also ruled out an OTel Web SDK — so every trace's root span id pointed at a span PostHog never received.

PostHog keys its trace lists on the root span (`is_root_span`: parent id all zeros). A trace with no exported root has no row in those lists. Verified on 2026-09-24 over 24 hours of data: zero root spans for any `POST /api/trpc/[trpc]`. Searching by the exact id still rendered the full tree, but browsing found nothing — which is how the operator ended up on the wrong trace (the Blob token mint, a plain server root) when looking for a receipt's ingest run.

Two facts about `@vercel/blob` 2.8.0 shape the fix. `upload({ headers })` exists, so adr018's "no header hook" claim is wrong. But `retrieveClientToken` reads only `res.json()` from the token route, so the browser can never see a response header from it — the server cannot hand a trace id back through `upload()`.

Where does the trace root live, and how does a developer obtain the id?

## Decision

We will root every trace at the first server span. The browser sends no `traceparent`: the tRPC `headers` hook sends only `x-trpc-source`, better-auth uses its default fetch, and `src/lib/traceparent.ts` is deleted. Each route root echoes the active trace id as an `x-trace-id` response header through `traceIdHeaders()` (`src/server/observability/current-trace-id.ts`) — the tRPC route and `POST /api/receipts/upload` today. The developer reads the id from the response, not the request.

The Blob token mint becomes an observed trace of its own: Next's `POST /api/receipts/upload` HTTP span is the root, with a `blob.token.mint` child carrying `member.id` and `posthog.distinct_id` from baggage, flushed via `after`. It is not chained into the `receipt.create` trace. One upload action therefore yields two traces, adjacent in time under one `posthog.distinct_id`; the receipt row's `traceId` names the ingest trace, and the panel labels it "Ingest trace ID".

Alternatives weighed, and why not:

- **Synthesise a root server-side** from the inbound `traceparent` — a span with invented timing standing in for a browser fetch we never measured. Rejected.
- **Chain the token id into `receipt.create` by bypassing `upload()`** — call `/api/receipts/upload` with our own fetch, read `x-trace-id`, then `put()` with the returned client token and forward the id on the mutation. The only route to one trace per action; it couples the app to Blob's internal `blob.generate-client-token` payload shape. Deferred, not rejected — revisit if two adjacent traces prove hard to read.
- **Keep rootless traces and search by id** — the lists are the discovery path; a trace you can only find by knowing its id is hidden. Rejected.
- **OTel Web SDK** to export the browser root — rejected in adr018 for weight; nothing has changed.

## Consequences

- Every trace has an exported root and appears in PostHog's trace lists.
- The id comes from the `x-trace-id` response header. A request that gets no response yields no id; server logs on that trace still carry `trace_id`.
- One upload action is two traces (token mint, then `receipt.create` → Bedrock). Join them by `posthog.distinct_id` and time. Retry and email ingest are one trace each, as before.
- `<img src="/api/receipts/[id]/image">` is a plain server root, now no different from any other request.
- Next still extracts an inbound `traceparent`, so a foreign client could parent a server span onto its own trace. Negligible for a private household app; no mitigation — the same posture adr018 recorded.
- Sampling stays parent-based always-on (`ParentBasedSampler({ root: AlwaysOnSampler })`, now behind `NameDropSampler`, which drops only Inngest's `inngest.execution`); roots record, outbox-continued Inngest runs still honour the producer's decision ([adr016](adr016-trace-context-in-outbox-payload.md)).
- adr018's no-OTel-Web stance stands. Client telemetry remains `posthog-js` work under [adr015](adr015-posthog-over-opentelemetry-via-vercel-otel.md).

## Links

- Supersedes: [adr018](adr018-client-originated-traceparent.md) — the browser-minted parent left every trace rootless
- Refines: [adr015](adr015-posthog-over-opentelemetry-via-vercel-otel.md) — server-only instrumentation, now with server-owned roots
- Builds on: [adr016](adr016-trace-context-in-outbox-payload.md) — the root's id crosses the outbox into Inngest unchanged
- SDK: `@vercel/blob` 2.8.0 `dist/client.d.ts` — `CommonUploadOptions.headers`; `retrieveClientToken` reads `res.json()` only
