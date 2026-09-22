---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-22'
# prettier-ignore
---

# Mint the trace id in the browser as a W3C `traceparent`; no OTel Web SDK

Technical Story: [2026-09-22 Client-originated traceparent](../../thoughts/designs/2026-09-22-client-traceparent.md)

## Context

The app instruments the server only ([adr015](adr015-posthog-over-opentelemetry-via-vercel-otel.md)). The browser sends no trace context, so every request starts its own root trace. A developer who opens `/receipts`, sees the `receipt.list` call in DevTools, and wants its PostHog trace has no id to search: the client never names one, and the server never hands one back.

The requirement is a correlation id a developer reads straight from the Network tab, with no backend round-trip. Two facts shape the path in:

- Next already extracts an inbound `traceparent` through the registered `W3CTraceContextPropagator` (`node_modules/next/dist/server/lib/trace/tracer.js:152`), so a client-supplied trace context makes the server span a child of the client's trace with no server code.
- adr015 plans all client-side work — feature flags, session replay, LLM evaluations — on the PostHog project, via `posthog-js`. It says nothing about a browser OpenTelemetry stack.

How does the browser originate the trace id, and does the app take on an OTel Web SDK to do it?

## Decision

We will mint a W3C `traceparent` per request in the browser with a hand-rolled helper (`src/lib/traceparent.ts`, native `crypto.getRandomValues`, flags always `01`) and send it on the two fetches the browser controls: the tRPC `httpBatchStreamLink` `headers` hook and the better-auth `customFetchImpl`. Next extracts it, so the server span parents onto the client trace and client `trace_id` equals server `trace_id` for free. The tRPC route echoes the active span's id as `x-trace-id` to verify the join.

The app will not run an OTel Web tracing stack. Client telemetry rides `posthog-js`, per adr015. Adopting a browser OTel SDK later overturns this decision.

Alternatives weighed, and why not:

- **OTel Web SDK** — ~30 KB gzip for the minimal fetch-injection stack, plus ~41 KB for an OTLP exporter to ship client spans, to do what native `crypto` does at ~0 KB. A parallel telemetry stack the roadmap never asks for.
- **A custom `X-Trace-ID` string** (the first ask) — a bare id is not a W3C trace id, so the server would need plumbing to promote it to the `trace_id`. A `traceparent` auto-correlates with zero server code.
- **A per-session correlation id** — coarser than a trace. A page load firing five queries would share one flat id with no span tree.
- **A per-procedure trace** — would force dropping `httpBatchStreamLink`. One POST carries one `traceparent`, so one trace per batch matches the single server handler.

## Consequences

- One trace id runs from the browser fetch through the whole server span tree. A developer reads it from the Network tab and searches PostHog with no round-trip.
- The client always sends flag `01`, so `parentbased_always_on` records the span. No custom `Sampler`.
- Two browser paths stay uninstrumented and start fresh server root traces, as today: the Blob `upload()` token call and `<img src="/api/receipts/[id]/image">`. Their SDKs expose no header hook. Accepted.
- This sets the direction for client observability: future work builds on `posthog-js`, not OTel-web.
- One unknown remains. Vercel's proxy may weigh inbound sampling against its own rules. The `x-trace-id` echo tests it on a preview deploy — send a known id, confirm the response matches. If the proxy ever strips the parent, the fix is a `ParentBased` sampler forcing `remoteParentSampled` on, one line in `otel.ts`, deferred until proven.
- A hostile client can send flag `00` to suppress its own span. Negligible for a private household app; no mitigation.

## Links

- Design: [2026-09-22 Client-originated traceparent](../../thoughts/designs/2026-09-22-client-traceparent.md)
- Refines: [adr015](adr015-posthog-over-opentelemetry-via-vercel-otel.md) — extends its server-only stance to a client-originated trace root
- Builds on: [adr016](adr016-trace-context-in-outbox-payload.md) — how the trace id crosses the outbox into Inngest
