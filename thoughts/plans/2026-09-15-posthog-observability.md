---
date: 2026-09-15
design: thoughts/designs/2026-09-15-posthog-observability.md
adrs: [adr015, adr016]
status: Ready to implement
---

# PostHog observability Implementation Plan

## Context

The server's entire observability surface is 11 `console.*` calls across 7
files. When a Receipt fails there is no single place to see the tRPC call or
inbound email that created it, the outbox delivery, each Inngest attempt, the
Bedrock prompt/response, tokens, cost and the error. Nothing alerts. This plan
ships traces, logs, LLM analytics and error tracking to the existing PostHog
project ("Rekurve") over OpenTelemetry, with **one trace id** from HTTP entry
through the outbox row into every Inngest attempt and the Bedrock span, and six
v1 alerts. It implements two Proposed ADRs: adr015 (transport + ports) and
adr016 (trace context across the outbox).

## Current State

**Nothing OTel/PostHog exists yet.**
- `src/instrumentation.ts` — absent. `src/server/observability/` — absent.
- `package.json` — no `@opentelemetry/*`, `@vercel/otel`, `@posthog/ai`, `posthog-node`. Installed: `ai` 5.0.252, `@ai-sdk/amazon-bedrock` 3.0.129, `inngest` 4.19.0, `next` 16.3.4.
- `src/env.js:13-89` server schema has no `POSTHOG_*` / `LOG_LEVEL`; `runtimeEnv` at `:104-122`.
- `infrastructure/vercel.tf:57-72` `local.vercel_env` holds only `AWS_REGION`, `AWS_ROLE_ARN`, `BEDROCK_RECEIPT_MODEL`; `for_each` resource at `:74-82`. `infrastructure/variables.tf:1-9` declares only `environment`. Terraform runs in `.github/workflows/deploy.yml:42-83` (`terraform-apply` job).

**The 11 real `console.*` sites** (design counted ~15 incl. test asserts/comments):
- `src/server/receipts/receipts.service.ts:191` — `console.error` in `process()` catch before `markFailed` (`:192`).
- `src/server/outbox/outbox.service.ts:123` (ack swallow), `:132` (recordFailure), `:137` (record-failure swallow).
- `src/server/email/email.service.ts:96` (`console.info` unknown sender), `:114` (`console.warn` empty attachments).
- `src/server/api/trpc.ts:100` — `console.log` duration in `timingMiddleware` (`:88-103`; dev sleep `:91-95`).
- `src/server/api/lib/assert-row.ts:8` — `console.error`.
- `src/server/auth/config.ts:36-38` (`say` = `console.error`/`warn` ternary), `:90` (`console.error`).
- `src/server/auth/secondary-storage.ts:55` — `console.error` in `fail()`.
- Route files (under `src/app/`, not counted above): `src/app/api/trpc/[trpc]/route.ts:24-31` dev-only `onError` `console.error`; `src/app/api/receipts/inbound/route.ts:46-49` `console.error` + 500.

**Outbox / Inngest mechanics**
- `src/server/inngest/events.ts:9-13` `EVENT_REGISTRY` (three `z.object({ receiptId })` schemas); `:21-25` `OutboxEventDescriptor { id; name; data: unknown }`; `:27-35` `buildOutboxEvent` — `data` parsed inline at `:34`.
- `src/server/outbox/outbox.service.ts:27-43` deps `{ repository; inngest: Pick<Inngest,"send"> }`; `commit` `:45-55`; `publish` `:57-62`; `sweep` `:75-93` (projects `{id,name,data}` `:83-87`, `deliver` `:88`); `deliver` `:102-114` — **the only `inngest.send`, at `:107`**; `ack` `:119-125`; `recordFailure` `:127-142`.
- `src/server/outbox/outbox.module.ts:10-13` — shared `outboxService = new OutboxService({ repository, inngest })`.
- `src/server/outbox/outbox.repository.ts:9` `OutboxRow` (has `createdAt`, `attempts`); `findUnsent` `:73-84` (unacked, older than 30 s).
- `src/server/outbox/outbox.controller.ts:23-33` declares `outbox-sweep` (`0 * * * *`) and `outbox-prune` (`0 3 * * *`); `get functions()` `:36-38`.
- `src/server/inngest/client.ts:13-16` — `new Inngest({ id: "personal-finance", eventKey })`; no `middleware`, no `logger`.
- `src/server/inngest/functions.ts:17-20` `OutboxController`; `:22-28` `ReceiptsService` (Bedrock bound here); `:29-32` `ReceiptsController`; `:34-37` `functions` spread.
- `src/server/receipts/receipts.controller.ts:8` `RETRIES = 3`; `:27-50` `process-receipt` with `concurrency.key = "event.data.receiptId"`; handler `:46-49` maps `attempt >= RETRIES` → `isFinalAttempt`.
- `src/server/receipts/receipts.service.ts:132-153` deps `{ repository; blobStore; languageModel }`; `process()` `:164-194`; `generateObject` `:264-268` — **no `experimental_telemetry`**.
- `src/server/email/email.controller.ts:28-64` `handle(request)`; verify `:39-49`; `service.ingest` `:63`. `email.service.ts:67-83` deps; `ingest()` `:89-125` — `sender.userId` (the Member) resolves `:91`, `createPendingReceipts` returns `receiptIds` `:120-123`.

**tRPC**
- `src/server/api/trpc.ts:29-38` `createTRPCContext` (`db`, `session`); `:112` `publicProcedure = t.procedure.use(timingMiddleware)`; `:122-134` `protectedProcedure` (UNAUTHORIZED `:125-126`, `ctx.session.user`).
- `src/app/api/trpc/[trpc]/route.ts:18-32` `fetchRequestHandler`; `:34` exports. No `after()`.
- `src/app/api/receipts/inbound/route.ts:20-38` `compose()` memo; `POST` `:40-51`. No `after()`.
- `src/app/api/inngest/route.ts:12` `serve({ client, functions })`; `maxDuration` `:10`. No `after()`.

**Patterns to mirror (adr004)**
- Interface + impl adapter in one file: `src/server/blob-store/blob-store.ts:15-31`, `src/server/email/email.mailbox.ts:19-42`.
- `interface XDeps` + `private readonly` constructor: `receipts.service.ts:132-153`, `outbox.service.ts:27-43`, `email.service.ts:67-83`.
- Tests: service harness `receipts.service.test.ts:59-141` (`console.error` spies at `:271,:288,:352`), `outbox.service.test.ts:27-70` (console asserts `:160,:241`), `email.service.test.ts:261`; controller spy `outbox.controller.test.ts:12-32`, `receipts.controller.test.ts:5-37`; repository fake db `outbox.repository.test.ts:1-86`; route root test `src/app/api/receipts/inbound/route.test.ts:6-91`; golden `src/server/inngest/registry-golden.test.ts:26-53`; `src/server/inngest/events.test.ts:9-30`.

**Constraints**
- `.claude/rules/bedrock-invocation.md:14` — nothing under `src/server/receipts/` imports `~/env`.
- `.claude/rules/server-architecture.md` — deps are objects with methods; no bare `fn` deps; composition roots only touch real SDKs; FROZEN ids/triggers pinned by the golden test.
- AGENTS.md — read `node_modules/next/dist/docs/` before any Next code (`instrumentation.md`, `after.md`, `open-telemetry.md`).
- `.env.example` is hook-protected and owner-edited.

## Desired End State

- One preview deploy + one Receipt (upload or email) produces, in PostHog: an APM trace containing `trpc.<path>` or `email.inbound` → `outbox.deliver` → `inngest.function.process-receipt` → `receipt.extract` → `ai.generateObject.doGenerate`, all on one `trace_id`; Logs filtered by that `trace_id` read the whole story; one `$ai_generation` with `posthog.distinct_id` = the Member, `$ai_trace_id` = the same trace id, prompt text with the image redacted, extracted JSON, tokens.
- A sweep re-delivery lands in the producer's trace, visibly late.
- Every failed Inngest attempt and every unhandled route error appears in Error Tracking with `distinctId` and `$trace_id`.
- Zero `console.*` calls under `src/server/**` and the three route files.
- `POSTHOG_KEY` unset: `registerOTel` skipped, logger writes stdout only, `captureException` no-op; `make test` passes without any key.
- Six alerts exist, filtered to `deployment.environment.name = production`.
- `registry-golden.test.ts` unchanged and green; no migration; `EVENT_REGISTRY` untouched.

## Out of Scope

Product analytics, feature flags, session replay, evaluations, Household `$groups`, DB spans, Inngest `extendedTracesMiddleware`, Slack alert destination, the AI SDK v7 upgrade (path documented in the design), migrating unmigrated tRPC routers to 3-tier.

## Approach

Build leaf units first with TDD (Logger, span processor, trace carrier, Inngest middleware), compose them in boot code that is a no-op without a key, then adopt them one domain at a time (outbox → receipts → email) so every phase leaves `make check` / `make test` green. adr016 is Phases 4–5 (carrier + middleware); adr015 is every other code phase. Infra and rules land last, followed by the preview spike that resolves the design's runtime unknowns against pre-decided fallbacks and creates the alerts.

Conventions used throughout: `Logger` is a dep object with methods (never a bare function); the tracer is the ambient `@opentelemetry/api` `trace.getTracer("personal-finance")` (no-op without an SDK, so no test fakes); alertable log records pass one attribute `event.name` which `OtelLogger` lifts onto the record's `eventName` field and keeps as a mirror attribute.

---

## Phase 1: Dependencies, env schema, `Logger` port + baggage

Implements adr015 clause 3 (the `Logger` port) and clause 5 (baggage keys).

### Changes
- `package.json` — add exact pins: `@vercel/otel` 2.1.3, `@opentelemetry/api` 1.9.0, `@opentelemetry/api-logs` 0.222.0, `@opentelemetry/sdk-logs` 0.222.0, `@opentelemetry/exporter-trace-otlp-http` 0.222.0, `@opentelemetry/exporter-logs-otlp-http` 0.222.0, `@opentelemetry/instrumentation` 0.222.0, `@opentelemetry/sdk-trace-base` 2.11.0, `@opentelemetry/resources` 2.11.0, `@opentelemetry/sdk-metrics` 2.11.0, `@posthog/ai` 8.11.1, `posthog-node` 5.52.2. `make install`. Verify peers resolve without warnings (design "Verified facts": `@vercel/otel` 2.x peers `sdk-trace-base >=2 <3`, `sdk-logs >=0.200 <0.300`, `api >=1.9 <2`; `@posthog/ai` peers `sdk-trace-base ^2`, `exporter-trace-otlp-http >=0.200`).
- `src/env.js:13-89` — add to `server`, all optional: `POSTHOG_KEY: z.string().startsWith("phc_").optional()` (a `phx_` personal key fails the prefix check — comment says why), `POSTHOG_HOST: z.url().default("https://us.i.posthog.com")`, `LOG_LEVEL: z.enum(["debug","info","warn","error"]).default("info")`, `BEDROCK_INPUT_TOKEN_PRICE_USD: z.coerce.number().positive().optional()`, `BEDROCK_OUTPUT_TOKEN_PRICE_USD` same. Mirror each in `runtimeEnv` (`:104-122`). Price vars stay **unset** until Phase 11 decides (design Decision 11).
- `src/server/observability/baggage.ts` — new. `export const BAGGAGE_KEYS = { memberId: "member.id", receiptId: "receipt.id", outboxEventId: "outbox.event_id", inngestRunId: "inngest.run_id", inngestAttempt: "inngest.attempt" } as const`; `setBaggage(attrs: Partial<Record<BaggageKey,string>>, ctx = context.active()): Context` (merges into existing baggage, returns a Context for `context.with`); `readBaggage(ctx = context.active()): Record<string,string>` (only our keys). Over `@opentelemetry/api` `propagation.getBaggage / createBaggage / setBaggage`.
- `src/server/observability/logger.ts` — new. `export interface Logger { debug(msg, attrs?); info(msg, attrs?); warn(msg, attrs?); error(msg, attrs?: LogAttributes & { error?: unknown }); with(attrs: LogAttributes): Logger }`. `interface OtelLoggerDeps { emitter: Pick<import("@opentelemetry/api-logs").Logger,"emit">; stdout: { write(line: string): void }; level: LogLevel; pretty: boolean; bound?: LogAttributes }` + `export class OtelLogger implements Logger`. Each call: drop below `level`; merge `bound` + call attrs + `readBaggage()` + active `trace_id`/`span_id`; on `error` with an `error` value add `exception.type`, `exception.message`, `exception.stacktrace`; if attrs contain `event.name`, set the record's `eventName` **and** keep the attribute; `emitter.emit({ severityNumber, severityText, body, attributes, eventName })`; write one JSON line to `stdout` (pretty when `pretty`). `with()` returns a new `OtelLogger` with merged `bound`. `export function createRootLogger(): OtelLogger` — binds `logs.getLogger("personal-finance")`, `process.stdout`, `env.LOG_LEVEL`, `pretty = env.NODE_ENV === "development"` (this is the only spot in the file that reads `~/env`; roots call it, tiers never do).
- `src/server/observability/logger.test.ts` — new. Fake `emitter` recording `emit` calls, fake `stdout` capturing lines. Slices: severity mapping per method; below-`level` dropped from both sinks; `with()` merges bound attrs and later `with()` wins on conflict; baggage keys copied when set via `setBaggage` + `context.with`; `exception.*` shape from an `Error` and from a non-Error; `event.name` attr lifted to `eventName` and still present as attribute; stdout line is valid JSON carrying `level`, `msg`, attrs.
- `src/server/observability/baggage.test.ts` — new. `setBaggage` round-trips through `readBaggage` under `context.with`; unknown baggage entries are not returned; merge keeps prior keys.

### Success
- [x] `make install` completes with no peer-dependency warnings for the pinned set
- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes (new deps bundle under Next 16)
- [x] `SKIP_ENV_VALIDATION` unset, app starts with none of the new vars set (all optional/defaulted)
- [x] `POSTHOG_KEY=phx_x` fails env validation; `phc_x` passes
- [x] `/security-review` (touches `src/env.js`)

---

## Phase 2: `ContextSpanProcessor`

Implements adr015 clauses 5 (baggage → span attrs, `posthog.distinct_id`) and 6 (image redaction), plus the Decision 11 price-stamp fallback.

### Changes
- `src/server/observability/span-processor.ts` — new. `interface ContextSpanProcessorDeps { inputTokenPriceUsd?: number; outputTokenPriceUsd?: number }` + `export class ContextSpanProcessor implements SpanProcessor` (`@opentelemetry/sdk-trace-base`). `onStart(span, parentContext)`: copy every `readBaggage(parentContext)` entry onto the span; if `member.id` present set `posthog.distinct_id`; if `span.name.startsWith("ai.")`: when `ai.prompt.messages` is a string, `JSON.parse` it, replace each part with `type === "file"` (or `"image"`) and a string `data` by `<redacted <mediaType> <byteLength> sha256:<hex>>` (byte length = decoded base64 length; hash over the decoded bytes), re-stringify and `setAttribute`; when prices are configured set `$ai_input_token_price` / `$ai_output_token_price`. `onEnd`, `shutdown`, `forceFlush` no-op. Malformed JSON: leave the attribute untouched, never throw.
- `src/server/observability/span-processor.test.ts` — new. In-memory `BasicTracerProvider` + `InMemorySpanExporter` with the processor registered, `W3CBaggagePropagator` not needed (baggage set via `setBaggage` + `context.with`). Slices: baggage keys land as attrs; `member.id` → `posthog.distinct_id`; span named `outbox.deliver` with a fake `ai.prompt.messages` attr is **not** redacted (non-`ai.*` untouched); span named `ai.generateObject.doGenerate` with a messages JSON containing a file part gets the exact stub text and the text part is unchanged; unparsable messages string left as-is; price attrs present only when deps configured.
- Note for the implementer: under `ai` 7.0.101 + `@ai-sdk/otel` `LegacyOpenTelemetry` (Phase 3), `ai.prompt.messages` is set in the span's **start** attributes, so `onStart` sees it. Confirm on the installed `node_modules/@ai-sdk/otel` (v7 moved span emission out of the `ai` package) before relying on the hook; if it turns out to be set post-start, move redaction to `onEnd` on the mutable `span.attributes` object — same tests, different hook.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] A 3 MB base64 file part reduces to a <200-byte stub in the test (asserts the 4 MB PostHog cap is respected)

---

## Phase 3: OTel boot composition + error-capture spine

Implements adr015 clauses 1, 2, 7 (the `onRequestError` choke point), 8, and Decision 14 (sampler). Boot code — no unit tests except the propagation guard.

Read first: `node_modules/next/dist/docs/03-api-reference/03-file-conventions/instrumentation.md`, `.../01-app/02-guides/open-telemetry.md`, `.../04-functions/after.md`.

### Changes
- `src/server/observability/posthog.ts` — new. Lazy `posthog-node` singleton built from `env.POSTHOG_KEY` / `env.POSTHOG_HOST` (`flushAt: 1`, `flushInterval: 0` is not needed — `flush.ts` calls `flush()`); `export function captureException(error: unknown, props?: Record<string, unknown>): void` — no-op when no key; `distinctId` = `readBaggage()["member.id"]` ?? `"server"`; adds `$trace_id` / `$span_id` from the active span, plus `props`. `export function shutdownPostHog()` for flush.
- `src/server/observability/otel.ts` — new. Exports `registerObservability(): void`. Returns early when `!env.POSTHOG_KEY`. Otherwise `registerOTel({ serviceName: "personal-finance", propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()], traceSampler: "parentbased_always_on", spanProcessors: ["auto", new ContextSpanProcessor({ inputTokenPriceUsd: env.BEDROCK_INPUT_TOKEN_PRICE_USD, outputTokenPriceUsd: env.BEDROCK_OUTPUT_TOKEN_PRICE_USD }), posthogSpanProcessor, traceBatch], logRecordProcessors: [logBatch] })` where `posthogSpanProcessor = new PostHogSpanProcessor({ projectToken, host })` from `@posthog/ai/otel`, `traceBatch = new BatchSpanProcessor(new OTLPTraceExporter({ url: \`${host}/i/v1/traces\`, headers: { Authorization: \`Bearer ${key}\` } }), { scheduledDelayMillis: 1000, exportTimeoutMillis: 5000 })`, `logBatch = new BatchLogRecordProcessor(new OTLPLogExporter({ url: \`${host}/i/v1/logs\`, same headers }), same batch opts)`. Keep the three processor handles in a module-level `registered` record for `flush.ts`. `instrumentationConfig.fetch.propagateContextUrls: []` (or the equivalent on the installed 2.1.3 `Configuration`) so **no** outbound `traceparent`/`baggage` reaches Bedrock or Resend. Sampler note: `"parentbased_always_on"` is a `@vercel/otel` `SampleOrName` string preset (`node_modules/@vercel/otel/dist/types/types.d.ts:9`, consumed by `traceSampler?: SampleOrName` at `:92`) — it records every root and honours a sampled parent, which is what the outbox-continued traces need. The earlier draft's custom `span name === "inngest.execution" → NOT_RECORD` branch is **dead code and dropped**: Inngest's own OpenTelemetry export is Out of Scope (design), so no `inngest.execution` span is ever created in this process — our Inngest spans are named `inngest.function.<id>` by the middleware (Phase 5). **AI SDK v7 telemetry wiring lands here too:** add `@ai-sdk/otel` (deps `ai` 7.0.101, peer `@opentelemetry/api` **1.9.1** — bump the repo's exact `1.9.0` pin to `1.9.1` in the same change so there is one copy of the OTel API) and call `registerTelemetry(new LegacyOpenTelemetry())` inside `registerObservability()`, once, before any `generateObject` runs. `LegacyOpenTelemetry` (not the SDK-recommended `OpenTelemetry`) keeps the `ai.*` span names + `ai.prompt`/`ai.prompt.messages` attributes that `ContextSpanProcessor` redaction and `PostHogSpanProcessor` both key on — the `OpenTelemetry` integration emits `gen_ai.*` semconv, which would make redaction silently no-op and ship raw receipt bytes (no type error, no failing test). Moving to `gen_ai.*` + `enrichSpan` is a deliberate follow-up, not coupled to this dep bump.
- `src/server/observability/flush.ts` — new. `export async function flushTelemetry(): Promise<void>` — `Promise.allSettled` over `traceBatch.forceFlush()`, `posthogSpanProcessor.forceFlush()`, `logBatch.forceFlush()`, `posthog-node` `flush()`; each wrapped in a 5 s timeout; never throws. No-op when nothing registered.
- `src/instrumentation.ts` — new. `export async function register() { if (process.env.NEXT_RUNTIME === "nodejs") { const { registerObservability } = await import("./server/observability/otel"); registerObservability(); } }`. **`onRequestError` must dynamic-import its deps under the same `nodejs` guard**, not static-import them: `posthog.ts` pulls in `posthog-node` and `logger.ts`/`flush.ts` are node-only, and Next loads `instrumentation.ts` in **both** the edge and nodejs runtimes — a top-of-file `import { captureException } from "./server/observability/posthog"` would drag `posthog-node` into the edge bundle and defeat the very deferral `register()` performs. So: `export const onRequestError: Instrumentation.onRequestError = async (error, request, ctx) => { if (process.env.NEXT_RUNTIME !== "nodejs") return; const [{ captureException }, { flushTelemetry }, { createRootLogger }] = await Promise.all([import("./server/observability/posthog"), import("./server/observability/flush"), import("./server/observability/logger")]); const attrs = { path: request.path, method: request.method, routerKind: ctx.routerKind, routeType: ctx.routeType }; captureException(error, attrs); createRootLogger().with({ domain: "next" }).error("unhandled route error", { error, ...attrs }); await flushTelemetry(); }`. Both `captureException` and `flushTelemetry` are no-ops when `POSTHOG_KEY` is unset, and `flushTelemetry` is self-bounded (5 s per-sink timeout, never throws), so awaiting it per error is the serverless flush-before-freeze choke point (adr015 clause 8), not an unbounded block.
- `next.config.ts` — **only if** `make build` fails to bundle an OTel package: add the offending package(s) to `serverExternalPackages` (design Risk 5). Record what was needed in the PR.
- `src/server/observability/propagation.test.ts` — new. The one unit test in this phase: register a `NodeTracerProvider` with an `AlwaysOnSampler` (the `"parentbased_always_on"` preset always records a root) and a `CompositePropagator([tracecontext, baggage])`; inside `context.with(setBaggage({ "member.id": "m1" }))` and an active span, assert `propagation.inject(context.active(), carrier)` **does** write `traceparent` + `baggage` (the outbox carrier relies on this) and that a `Headers` object built for an outbound `fetch` by our code gets **no** `baggage`/`traceparent` unless explicitly injected — i.e. the app never calls `inject` on outbound HTTP. No custom-sampler assertion: the sampler is now the built-in `"parentbased_always_on"` string preset (there is no `inngest.execution` branch to test — Inngest OTel is Out of Scope).

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes (OTel bundles under Next 16 Turbopack; no `serverExternalPackages` needed; the env-gate failure on `DEPLOYMENT_URL`/`INNGEST_*` is pre-existing prod-env validation, unrelated to Phase 3 — verified bundling with `SKIP_ENV_VALIDATION=1`)
- [x] `make start` with no `POSTHOG_KEY`: `registerObservability()` no-op, nothing registered, no OTel warnings (verified directly)
- [x] `make start` with `POSTHOG_KEY` set: SDK registered once, idempotent on a second call, all three processor handles present (verified directly)
- [ ] `/security-review` (touches `src/instrumentation.ts`; `next.config.js` unchanged — no bundling fix needed) — **NOT clean.** New HIGH finding on re-validation: `@vercel/otel` "auto" fetch instrumentation records `http.url`/`http.target` on outbound fetch spans, unscrubbed, and ships them to PostHog. `inngest.send` posts to `https://inn.gs/e/<INNGEST_EVENT_KEY>` (Inngest.js:611) via the OTel-patched `globalThis.fetch` (Inngest.js:178), so the production Inngest event key leaks into PostHog on every outbox delivery. Fix in `otel.ts`: `fetch.ignoreUrls: [/^https?:\/\/inn\.gs\//]`. Rotate `INNGEST_EVENT_KEY` if any env deployed with `POSTHOG_KEY` set. (error→PostHog PII is the separate pre-existing tracked TODO(security).)

---

## Phase 4: Trace carrier + outbox mint (`data._trace`)

Implements adr016 clauses 1 and 2 — `docs/adr/adr016-trace-context-in-outbox-payload.md`.

### Changes
- `src/server/observability/trace-carrier.ts` — new. `export interface TraceCarrier { traceparent?: string; tracestate?: string; baggage?: string }`; `export const TRACE_CARRIER_KEY = "_trace" as const`; `export function captureTraceCarrier(ctx = context.active()): TraceCarrier` → `propagation.inject(ctx, {})` (returns `{}` when no propagator/SDK); `export function restoreTraceCarrier(carrier: unknown): Context | null` — accept only a plain object with string values for the three keys, `propagation.extract(ROOT_CONTEXT, carrier)`, return `null` when the resulting span context is invalid (`trace.getSpanContext(ctx)` undefined or `!isSpanContextValid`).
- `src/server/inngest/events.ts:31-35` — hoist `const data = EVENT_REGISTRY[name].parse(payload)`; return `{ id, name, data: { ...data, [TRACE_CARRIER_KEY]: captureTraceCarrier() } }`. `OutboxEventDescriptor.data` stays `unknown` (`:24`). Registry schemas and keys untouched. JSDoc one-liner: the pocket is appended after parse so `z.object` stripping never removes it; nothing else writes it.
- **Data-at-rest note (record in adr016 clause 2, don't just leave implicit).** `captureTraceCarrier()` injects `baggage` as well as `traceparent`/`tracestate`, and that `baggage` string carries our correlation keys — `member.id`, `receipt.id`, etc. Because the pocket lands in `data`, it is **persisted in the outbox `data` jsonb column at rest** and re-sent verbatim on sweep. Keep it (the Phase 5 consumer restores `member.id`/`receipt.id` from it for async-side correlation), but record in adr016 that this is deliberate and safe: `readBaggage`/`setBaggage` filter to `BAGGAGE_KEYS` only (member/receipt/outbox/inngest ids), every one a non-secret identifier already stored in canonical rows — **no session token or secret can reach the pocket** because it isn't a baggage key. Add a one-line assertion to the events test that the persisted `_trace.baggage`, when present, contains no key outside `BAGGAGE_KEYS`.
- `src/server/observability/trace-carrier.test.ts` — new. Register a `NodeTracerProvider` + `CompositePropagator([W3CTraceContextPropagator, W3CBaggagePropagator])` in the test. Slices: capture under an active span + `member.id` baggage yields `traceparent` (matching the span's trace id) and `baggage`; `restoreTraceCarrier(captured)` yields a Context whose span context has the same `traceId` and whose baggage has `member.id`; `restoreTraceCarrier({})`, `restoreTraceCarrier(undefined)`, `restoreTraceCarrier({ traceparent: "garbage" })`, `restoreTraceCarrier("string")` → `null`; capture with no active span → `{}`.
- `src/server/inngest/events.test.ts:9-15` — update the first case: `expect(event.data).toEqual({ receiptId: 1, _trace: expect.any(Object) })`; add a case: under an active span (register a provider in the test) `event.data._trace.traceparent` matches the trace id; add a case: `_trace` is present even when no SDK is registered (`{}`).
- `src/server/outbox/outbox.service.test.ts` — add one assertion in the `commit` path: the event handed to `inngest.send` carries `data._trace` (the descriptor the fake `events()` callback returned via `buildOutboxEvent` is sent byte-for-byte). Sweep path: a row whose `data` already holds `_trace` is re-sent with the same `_trace` (`outbox.service.ts:83-87` projects `row.data` verbatim).

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `registry-golden.test.ts` unchanged and green
- [x] No Drizzle migration generated (`make db_generate` produces nothing; `pnpm run db:check` clean)

---

## Phase 5: Inngest `tracingMiddleware` + client wiring

Implements adr016 clauses 3–5 (restore + continue + link, not-stripped, missing pocket) and adr015 clause 7's third choke point (`onRunError`) — `docs/adr/adr016-trace-context-in-outbox-payload.md`, `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md`. adr016 clause 6 (drop Inngest's own `inngest.execution` root) is a **sampler** concern owned by the adr015 boot (`otel.ts`), not this middleware — currently unimplemented (`otel.ts:51` is `parentbased_always_on`, no name-drop), tracked as Follow-up F3.

### Changes
- `src/server/observability/inngest-middleware.ts` — new. **Inngest 4.19 middleware is a class, not the v3 `new InngestMiddleware({ init })` factory**, and the client news it up per request via a fixed `constructor({ client })` (`Middleware.Class` in `node_modules/inngest/components/middleware/middleware.d.ts`) — so deps **cannot** be constructor-injected. `export class TracingMiddleware extends Middleware.BaseMiddleware` (`import { Middleware } from "inngest"`) with `readonly id = "tracing"` and no constructor of its own (inherits `({ client })`). Its logging/capture deps are **module-level roots**, not fields: `const logger = createRootLogger().with({ domain: "inngest", component: "tracing" })` and the imported `captureException`. This file is core wiring, a root — building a root logger here is the same adr004-sanctioned exception route files and `onRequestError` use; no DI seam exists because the base constructor is fixed. Hooks are flat methods on the class (all args are `DeepReadonly` per the `.d.ts` — the event/ctx are read-only, never mutated):
  - `async wrapFunctionHandler({ ctx, fn, next }): Promise<unknown>` — `ctx.event`, `ctx.runId`, `ctx.attempt` carry the run data (`BaseContext`, `node_modules/inngest/types.d.ts:466`). `let parent = restoreTraceCarrier(ctx.event.data?._trace)`; if `null` → `logger.warn("trace carrier missing", { "event.name": "trace.carrier.missing", "inngest.function_id": fn.id(), "inngest.run_id": ctx.runId })` and `parent = ROOT_CONTEXT`. `const parentSpan = trace.getSpanContext(parent)`; start `inngest.function.${fn.id()}` via `tracer.startSpan(name, { links: parentSpan ? [{ context: parentSpan }] : [], attributes: { "inngest.run_id": ctx.runId, "inngest.attempt": ctx.attempt, "inngest.function_id": fn.id(), "inngest.event_name": ctx.event.name } }, parent)`; `const runCtx = setBaggage({ "inngest.run_id": ctx.runId, "inngest.attempt": String(ctx.attempt), "outbox.event_id": ctx.event.id, "receipt.id": String(ctx.event.data?.receiptId) when present }, trace.setSpan(parent, span))` — **don't re-pass `member.id`**: it's already on `parent`'s baggage (restored from the pocket) and `setBaggage` merges onto the supplied ctx (`baggage.ts:14-17` "prior keys preserved"), while `trace.setSpan` leaves baggage untouched — so member.id flows through untouched. `ctx.event.id` is optional (undefined on a hand-sent event); `setBaggage` skips undefined values. `return await context.with(runCtx, () => next())` in a try/finally that ends the span; on throw `span.recordException(err)` + `span.setStatus({ code: SpanStatusCode.ERROR })`, rethrow. The event is never mutated (it's `DeepReadonly` anyway). Caveat from the `.d.ts`: on a request where a fresh step is discovered `next()` never resolves, so the finally runs only on the completing request — fine for our single-pass workers (`outbox-*`, `process-receipt` extract inline, no `step.run`); revisit if a stepped function is added.
  - `async onRunError({ ctx, error, fn, isFinalAttempt }): Promise<void>` — the 4.19 hook supplies `isFinalAttempt` directly (retries exhausted or non-retriable), so drop the old manual `attempt >= retries` math: `captureException(error, { "inngest.function_id": fn.id(), "inngest.run_id": ctx.runId, "inngest.attempt": ctx.attempt, isFinalAttempt, "receipt.id": String(ctx.event.data?.receiptId) when present })` and `logger.error("inngest run failed", { error, ...same attrs })`.
- `src/server/inngest/client.ts:13-16` — `new Inngest({ id: "personal-finance", eventKey: env.INNGEST_EVENT_KEY, logger: wrapStringFirstLogger(createRootLogger().with({ domain: "inngest" })), middleware: [TracingMiddleware] })`. Pass the **class** (`Middleware.Class`), not an instance — Inngest constructs it per request with `{ client }`. Wrap the logger with `wrapStringFirstLogger` (from `inngest`, `node_modules/inngest/helpers/log.d.ts`): Inngest calls its logger Pino-style object-first (`logger.info({ … }, "msg")`) but `OtelLogger` is string-first (`info(msg, attrs)`); the wrapper reorders object-first calls to string-first. Without it Inngest's `{ obj }, "msg"` calls would bind `msg = { obj }` and drop the real message.
- `src/server/observability/inngest-middleware.test.ts` — new. Because the base constructor is fixed `({ client })`, deps aren't injectable — the test builds `new TracingMiddleware({ client: {} as never })` and calls the hook methods directly (`mw.wrapFunctionHandler({ ctx, fn, next })`, `mw.onRunError({ ctx, error, fn, isFinalAttempt })`) with a hand-built `ctx` (`event`, `runId`, `attempt`) and a fake `fn` (`id: () => "process-receipt"`); `next` = a spy that captures `context.active()` and `trace.getSpan(...)`. Register a test `NodeTracerProvider` + propagators + `InMemorySpanExporter`. The module-level `logger` writes to `process.stdout`, so assert log output by spying `process.stdout.write` and parsing the JSON line (its `msg` + attrs) — not by a fake logger. Slices: (1) with a valid `_trace`, the started span shares the producer's `traceId`, its parent is the producer span, and it carries one link to the producer span context; (2) `next()` ran with baggage `inngest.run_id`, `inngest.attempt`, `outbox.event_id`, `receipt.id`, and the producer's `member.id`; (3) the `event` object passed in is deep-equal to what `next` observed (`_trace` still present, nothing rewritten); (4) missing `_trace` → span is a new root, one stdout line with `event.name: "trace.carrier.missing"` at `level: "warn"`, handler still ran; (5) malformed `_trace` → same as (4); (6) `next` throws → span status ERROR + exception recorded, error rethrown; (7) `onRunError` → one stdout `error` line `"inngest run failed"` with the `inngest.*` attrs and `isFinalAttempt`. The `captureException` side of `onRunError` is a no-op without `POSTHOG_KEY`, so it's verified observably in Phase 11 (a forced final-attempt failure surfaces an Error Tracking issue), not here.
- `src/server/inngest/registry-golden.test.ts:26-53` — **unchanged**; it constructs controllers with a spy client, not `client.ts`, so the middleware never enters it. Confirm green.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [ ] `make start` + Inngest dev server: a hand-sent `receipt/retry` event from the Inngest dashboard (no `_trace`) runs to completion and logs one `trace.carrier.missing` warn — never fails the run
- [ ] A real upload produces a run whose stdout log lines all carry the same `trace_id` as the tRPC request line
- [ ] **`outbox.event_id` join (one-time live check — see Follow-up F1):** on that run, the logged `outbox.event_id` is the outbox row UUID PK, **not** an Inngest ULID. Inngest docs don't guarantee the sent `id` is echoed as `ctx.event.id`, and no unit test can cover this server hop (all circular). If it's a ULID, stamp the PK into the event `data` (alongside `_trace`) and read that instead. A real integration harness (F1) will guard this against future Inngest releases.
- [ ] Known consequence: with no `POSTHOG_KEY` locally, every run logs `trace.carrier.missing` once (no propagator registered, so the producer wrote `{}`). Accepted per design Decision 13.

---

## Phase 6: tRPC `devLatencyMiddleware` + `tracingMiddleware`, tRPC route flush, shared-root logger migration

Implements adr015 data-flow step 1 and clause 7's second choke point, Decision 16 (dev latency stays, outside the span). Also migrates the four non-domain `console.*` sites that have no DI seam — they construct a root `OtelLogger` directly, exactly as route files do (design: "Route files and `onRequestError` use `OtelLogger` directly (they are roots)").

### Changes
- `src/server/api/trpc.ts:88-103` — **characterization first**: add `src/server/api/trpc.test.ts` asserting the current `timingMiddleware` behaviour on a caller built from `createTRPCRouter` (dev → resolves after ≥100 ms; non-dev → resolves immediately; result passes through). Then split: `devLatencyMiddleware` = the `:91-95` sleep only, guarded by `t._config.isDev`; `tracingMiddleware` = `tracer.startActiveSpan(\`trpc.${path}\`, { attributes: { "trpc.type": type, "trpc.path": path } }, async (span) => { const baggageCtx = setBaggage({ "member.id": ctx.session?.user?.id }); return context.with(baggageCtx, async () => { const result = await next(); if (!result.ok) { span.setAttribute("trpc.error_code", result.error.code); span.recordException(result.error); span.setStatus(ERROR); if (result.error.code === "INTERNAL_SERVER_ERROR") { captureException(result.error, { "trpc.path": path }); logger.error("trpc internal error", { error: result.error, "trpc.path": path }) } else { logger.warn("trpc request failed", { "trpc.path": path, "trpc.error_code": result.error.code }) } } return result }) })` with `span.end()` in `finally`. Delete the `:100` `console.log`; the span carries duration. Module-level `const logger = createRootLogger().with({ domain: "trpc" })` (this file is core wiring, a root). Chain: `:112` `publicProcedure = t.procedure.use(devLatencyMiddleware).use(tracingMiddleware)`; `:122` `protectedProcedure = t.procedure.use(devLatencyMiddleware).use(tracingMiddleware).use(<auth>)`. Note `tracingMiddleware` reads `ctx.session` (set by `createTRPCContext` `:29-38`) so the Member is on baggage before the auth check. The OTel `Context` returned by `setBaggage` is named `baggageCtx`, **never** `ctx` — a `const ctx = setBaggage({ "member.id": ctx.session?… })` shadows the tRPC `ctx` param and reads it in its own initializer, a TDZ `ReferenceError` at runtime.
- `src/server/api/trpc.test.ts` — extend: non-dev → no delay (design Testing bullet); an `INTERNAL_SERVER_ERROR` thrown by a procedure → the span on an `InMemorySpanExporter` registered in the test has status ERROR + `trpc.error_code = INTERNAL_SERVER_ERROR`; a `BAD_REQUEST` → span ERROR + `trpc.error_code = BAD_REQUEST`. No module mocking of `posthog.ts`: the `captureException` call is verified observably in Phase 11 (an Error Tracking issue appears for a forced 500), not by a unit test.
- `src/app/api/trpc/[trpc]/route.ts:18-32` — `import { after } from "next/server"`; call `after(flushTelemetry)` inside the handler before returning `fetchRequestHandler(...)`. Replace the dev-only `onError` `console.error` (`:24-31`) with `logger.error("trpc handler error", { error, "trpc.path": path })` using a module-level root logger `with({ domain: "trpc", component: "route" })`; keep the dev-only guard.
- `src/server/api/lib/assert-row.ts:8` — module-level `const logger = createRootLogger().with({ domain: "trpc", component: "assert-row" })`; `logger.error(\`Failed to ${operation}.\`, { operation })`. Existing tests (if any) that spy `console.error` switch to asserting the throw only.
- `src/server/auth/config.ts:36-38`, `:90` — module-level `const logger = createRootLogger().with({ domain: "auth" })`; `:36-38` → `(NODE_ENV === "production" ? logger.error : logger.warn)` is a method reference — write it as `const level = NODE_ENV === "production" ? "error" : "warn"; logger[level]("KV not configured — sessions falling back to Postgres", { "event.name": "auth.kv.missing" })`; `:90` → `logger.error("sign-out revocation failed", { "error.name": error instanceof Error ? error.name : typeof error })` (keep the adr007 redaction: name only, **do not** pass `error` — the stack could carry the session token).
- `src/server/auth/secondary-storage.ts:53-59` — `fail()` → `logger.error(\`${operation} failed\`, { operation, reason })` with a module-level root logger `with({ domain: "auth", component: "redis" })`. `src/server/auth/secondary-storage.test.ts:47` currently mocks `console.error` — switch to asserting the returned `RedisUnavailableError` message (the redacted reason is already in it).

### Success
- [ ] `make check` passes
- [ ] `make test` passes (existing router tests untouched and green)
- [ ] `grep -rn "console\." src/server/api src/server/auth src/app/api/trpc` returns nothing
- [ ] `make start`, hit any tRPC route: stdout shows one JSON log line per failing call with `trace_id`, none for success (duration lives on the span, not a log)
- [ ] Non-dev test: procedure resolves in <50 ms (no fake latency)

---

## Phase 7: Outbox domain observability + Inngest route flush

Implements adr015 clause 3 (business spans `outbox.deliver`, `outbox.sweep.row`), the `outbox.sweep.stuck` alertable log event (design Data flow step 3; adr002's "stuck"), and the Inngest route flush (clause 8).

### Changes
- `src/server/outbox/outbox.service.ts:27-43` — `OutboxServiceDeps` gains `logger: Logger`; store `private readonly logger`. Constants at top: `STUCK_AFTER_MS = 60 * 60 * 1000` (one sweep interval — `outbox.controller.ts:26` cron is hourly). `deliver` (`:102-114`) wraps the send in `tracer.startActiveSpan("outbox.deliver", { attributes: { "outbox.event_id": event.id, "outbox.event_name": event.name, "outbox.delivery_context": context } }, ...)` inside `context.with(setBaggage({ "outbox.event_id": event.id }))`; on send failure `recordException` + ERROR. `sweep` (`:75-93`) per row: `tracer.startActiveSpan("outbox.sweep.row", { attributes: { "outbox.event_id": row.id, "outbox.attempts": row.attempts, "outbox.age_s": ageS } })`; when `ageS * 1000 >= STUCK_AFTER_MS` → `this.logger.warn("outbox row stuck", { "event.name": "outbox.sweep.stuck", "outbox.event_id": row.id, "outbox.event_name": row.name, "outbox.attempts": row.attempts, "outbox.age_s": ageS })` (computed from `row.createdAt`, `OutboxRow` at `outbox.repository.ts:9`). `ack` `:119-125` → **change its return type to `Promise<boolean>`**: `true` after `markProcessed` resolves, `false` in the catch (still `this.logger.error("outbox ack failed", { error, "outbox.event_id": id, "outbox.delivery_context": context })`, still swallowed — the row stays unacked for the next sweep). `recordFailure` `:132` → `this.logger.error("outbox delivery failed", { error, ... })`; `:137` → `this.logger.error("outbox failure-record failed", { error: recordError, ... })`. The `outbox delivered` heartbeat is the operational one-line-per-delivery signal, but it must fire **only on a real ack** — `deliver` `:112-113` currently does `await this.ack(...); return true` unconditionally, so a swallowed `markProcessed` failure would still log "delivered" for a row that is not acked (a lie; the sweep will re-deliver it). Fix: `const acked = await this.ack(id, context); if (acked) this.logger.info("outbox delivered", { "outbox.event_id": event.id, "outbox.event_name": event.name, "outbox.delivery_context": context }); return true;` — the send did succeed (so `deliver` still returns `true`), but the heartbeat tracks durable ack, and the `ack failed` error already covers the unacked case.
- `src/server/outbox/outbox.module.ts:10-13` — bind `logger: createRootLogger().with({ domain: "outbox", component: "service" })`.
- `src/server/outbox/outbox.service.test.ts:27-70` — harness gains a fake `logger: Logger` (object literal recording `{ level, msg, attrs }` into an array; `with()` returns itself after recording bound attrs). Replace the `console.error` asserts at `:160`, `:241` with assertions on the recorded `error` entries (msg + `outbox.event_id`). New slices: successful delivery logs one `info` (`outbox delivered`); a delivery whose `markProcessed` throws logs one `error` (`outbox ack failed`) and **no** `outbox delivered` info (the send returned `true`, but the row is unacked — the heartbeat must not claim delivery); a sweep row aged ≥ 1 h logs exactly one `warn` with `event.name: "outbox.sweep.stuck"` and `outbox.age_s`; a row aged 5 min logs no stuck warn; spans: register an `InMemorySpanExporter` in the harness and assert one `outbox.deliver` span per send with `outbox.event_id`, and one `outbox.sweep.row` per swept row.
- `src/app/api/inngest/route.ts:12` — wrap: keep `serve(...)` but export handlers that call `after(flushTelemetry)` before delegating (`export const GET = (req) => { after(flushTelemetry); return handlers.GET(req) }`, same for `POST`, `PUT`). Read `after.md` first — `after()` must be called inside a request scope. Keep `maxDuration` `:10`.
- `src/server/inngest/functions.ts:17-20` — no change for outbox (service comes from the module).

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `grep -rn "console\." src/server/outbox` returns nothing
- [ ] `registry-golden.test.ts` unchanged and green (ids/crons untouched)
- [ ] `make start`: one upload → stdout shows `outbox delivered` with `trace_id` equal to the tRPC line's

---

## Phase 8: Receipts domain observability

Implements adr015 clause 4 (LLM analytics via AI SDK telemetry, `functionId: "receipt.extract"`), clause 3 (`receipt.extract` span), and the `receipt.failed` alertable log event.

Constraint: `.claude/rules/bedrock-invocation.md:14` — nothing under `src/server/receipts/` imports `~/env`. `experimental_telemetry` needs no env. `Logger` arrives injected.

> **Why the park path MUST capture its own error (Phase 5 gap).** The Inngest `TracingMiddleware.onRunError` hook (Phase 5) is the run-failure choke point that calls `captureException` → PostHog Error Tracking. It only fires when a run **throws**. But `process()` deliberately parks-not-throws (`receipts.service.ts:184-193`, the frozen retry contract): a deterministic failure (schema/FK/blob/too-large) parks on the first catch and **never throws**, and a retryable failure on the **final** attempt also parks. So `onRunError` sees a *successful* run for every terminal receipt failure — the only cases that are actually broken — and creates **zero** Error Tracking issues for them. `onRunError` only ever catches transient mid-retry blips. A `logger.error("receipt.failed", …)` log line is NOT an Error Tracking issue — the log exporter and `captureException` are different sinks (adr015 clause 7). Therefore Phase 8 owns the terminal-failure Error Tracking signal at the domain tier; it must not rely on the middleware.
>
> **Required:** at the park path (below), in addition to the `receipt.failed` log, call PostHog `captureException(error, { "receipt.id", "receipt.channel", "member.id", "receipt.reason" })` **inside** the active `receipt.extract` span + baggage context, so the issue carries `$trace_id` + `member.id` and joins the run's trace. Do NOT make the service throw on final to trigger `onRunError` — that would break the parking contract. The retryable-not-final path already throws, so the middleware still covers those; do not double-capture there.

### Changes
- `src/server/receipts/receipts.service.ts:132-153` — `ReceiptsServiceDeps` gains `logger: Logger`. `process()` (`:164-194`): wrap the body after the status guard in `tracer.startActiveSpan("receipt.extract", { attributes: { "receipt.id": receiptId, "receipt.channel": receipt.channel, "receipt.is_final_attempt": isFinalAttempt } }, ...)` inside `context.with(setBaggage({ "receipt.id": String(receiptId), "member.id": receipt.userId }))` (confirm the column name on `receipts.schema.ts` — the Member FK; `email.service.ts:121` calls it `sender.userId`). Outcomes as span attrs: `receipt.outcome` = `processed` | `duplicate` | `failed` | `retry`. Catch (`:184-193`): retryable + not final → `this.logger.warn("receipt extraction retrying", { error, "receipt.id", "receipt.channel", "receipt.is_final_attempt" })`, span status ERROR, rethrow; park path → `this.logger.error("receipt extraction failed", { error, "event.name": "receipt.failed", "receipt.id", "receipt.channel", "receipt.is_final_attempt", "receipt.reason": memberFacingError(error) })` replacing `:191`, **and** `captureException(error, { "receipt.id": String(receiptId), "receipt.channel", "member.id": receipt.userId, "receipt.reason": memberFacingError(error) })` (this is the Error Tracking signal `onRunError` can't provide for parked runs — see the note above; it runs inside the `receipt.extract` span + baggage so `$trace_id`/`member.id` attach), then `markFailed` (`:192`). Values reuse the code's words: `ReceiptStatus.Failed` → `receipt.failed`.
- `src/server/receipts/receipts.service.ts:264-268` — `generateObject({ model, schema, messages, telemetry: { isEnabled: true, recordInputs: true, recordOutputs: true, functionId: "receipt.extract" } })`. In `ai` v7 the option is `telemetry` (the `experimental_telemetry` alias still compiles). No `metadata` (PostHog drops `ai.telemetry.metadata.*` — correlation comes from baggage via the processor). v7 telemetry is **opt-out**: once `@ai-sdk/otel` is registered (Phase 3), inputs record by default, so `ContextSpanProcessor` redaction MUST be registered before telemetry fires — the base64 receipt image would otherwise ship raw.
- `src/server/inngest/functions.ts:22-28` — `new ReceiptsService({ ..., logger: createRootLogger().with({ domain: "receipts", component: "service" }) })`.
- `src/server/receipts/receipts.service.test.ts:59-141` — harness gains the fake `logger` (same shape as Phase 7) and an `InMemorySpanExporter`. Replace the `console.error` spies at `:271`, `:288`, `:352` with assertions on recorded `error` entries. New slices: parked receipt → exactly one `error` with `event.name: "receipt.failed"` and `receipt.id`; retryable-not-final → one `warn`, no `receipt.failed`, error rethrown; duplicate path → span `receipt.outcome = duplicate`, no error log; the stub `languageModel` path already used (`{} as LanguageModel`) keeps `generateObject` un-invoked in the guard/duplicate tests — for the telemetry option, add one test with a `MockLanguageModelV4` (from `ai/test` — `LanguageModel` is `LanguageModelV4` in v7; the old `MockLanguageModelV2` name is gone) asserting the `receipt.extract` span exists and that an `ai.generateObject` child span is present under the same trace (with `@ai-sdk/otel`'s `LegacyOpenTelemetry` registered — see Phase 3 — the child keeps the `ai.generateObject` name the redaction path keys on; the SDK emits it on the global tracer registered by the test provider).
- `src/server/receipts/receipts.controller.ts:46-49` — no change; `isFinalAttempt` already flows. Test `receipts.controller.test.ts:5-37` unchanged.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `grep -rn "console\." src/server/receipts` returns nothing
- [ ] `make start` + Inngest dev + a real upload (with AWS creds via `assume`): stdout shows `receipt.extract` span-bearing log lines, and forcing a parse failure (e.g. temporarily invalid `BEDROCK_RECEIPT_MODEL`) logs `event.name=receipt.failed` on the final attempt
- [ ] the same forced failure produces a PostHog **Error Tracking** issue carrying `$trace_id` + `member.id` (the domain-tier `captureException`; confirms parked failures surface as issues without `onRunError`)
- [ ] add a `receipts.service.test.ts` slice asserting the park path calls `captureException` once (fake capture in the harness), alongside the `receipt.failed` log assertion
- [ ] `registry-golden.test.ts` unchanged and green

---

## Phase 9: Email domain observability + inbound route flush

Implements adr015 clause 3 (`email.inbound` span, `member.id` on resolve, `receipt.id` after insert), clause 8 (route flush), and the "Inbound webhook error" alert's log signal (`domain=email severity=ERROR`).

### Changes
- `src/server/email/email.controller.ts:22-26` — `EmailControllerDeps` gains `logger: Logger`. `handle()` (`:28-64`): after signature verification succeeds (`:49`) open `tracer.startActiveSpan("email.inbound", { attributes: { "email.id": parsed.data.data.email_id, "email.event_type": parsed.data.type } })` around parse + `ingest` (`:51-63`); the pre-verify path stays unlogged and span-less by design (`:45-48` — a rejected caller learns nothing, and we don't want unauthenticated noise in traces). If `ingest` throws: `span.recordException`, ERROR, `this.logger.error("inbound email failed", { error, "email.id" })`, rethrow (the 5xx still earns the Svix retry).
- `src/server/email/email.service.ts:67-83` — `EmailServiceDeps` gains `logger: Logger`. `ingest()` (`:89-125`): once `sender` resolves (`:91`) run the rest inside `context.with(setBaggage({ "member.id": sender.userId }))`; `:96` `console.info` → `this.logger.info("inbound email dropped: unknown sender", { "email.id": event.data.email_id, "email.from_domain": <domain part only — never the full address, a Member identifier> })`; `:114` `console.warn` → `this.logger.warn("inbound email attachments resolved to nothing", { "email.id", "email.qualifying": qualifying.length })`; after `createPendingReceipts` (`:120-123`) `this.logger.info("inbound email ingested", { "email.id", "receipt.ids": receiptIds })` and `trace.getActiveSpan()?.setAttribute("receipt.ids", receiptIds)`.
- `src/app/api/receipts/inbound/route.ts:20-51` — `compose()` binds `logger: rootLogger.with({ domain: "email", component: "controller" })` and `.with({ component: "service" })`; `POST` calls `after(flushTelemetry)` first; the `:46-49` `console.error` → `rootLogger.with({ domain: "email", component: "route" }).error("Resend credentials are not configured", { "event.name": "email.route.unconfigured" })` — still returns 500.
- `src/app/api/health/route.ts:15` — the readiness probe is its own root (nodejs runtime, `force-dynamic`, imports `~/server/db`), so migrate its `console.error` like the other route files or the `grep` gate below fails on it (it's the 12th site, outside every domain phase). Module-level `const logger = createRootLogger().with({ domain: "health", component: "route" })`; `:15` → `logger.error("readiness check failed", { "error.name": error instanceof Error ? error.name : typeof error, "event.name": "health.readiness.failed" })`. Name-only, **do not pass `error`** (adr007): a db driver error's message/stack can carry the connection string, and `logger.error` still emits message+stack to PostHog (the Phase 1 TODO isn't fixed yet). Still returns 503; no `after(flushTelemetry)` — a probe path stays lean and the deploy gate reads the 503, not PostHog. `src/app/api/health/route.test.ts` (if present) that spies `console.error` switches to asserting the 503 body.
- `src/server/email/email.controller.test.ts` — harness gains fake `logger`; add: `ingest` throws → `logger.error` once with `email.id`, response rejects (existing behaviour); an `InMemorySpanExporter` shows one `email.inbound` span for a verified event and none for a 401.
- `src/server/email/email.service.test.ts:261` — replace the console assert with the recorded `info`/`warn` entries; add: unknown sender log carries `email.from_domain` and **not** the full `from`; ingested path logs `receipt.ids`.
- `src/app/api/receipts/inbound/route.test.ts:6-91` — mocks already stub the tier modules; add `vi.mock("~/server/observability/flush", ...)` and assert `flushTelemetry` is scheduled via `after` (mock `next/server` `after` to invoke synchronously). Assert the 500 path still returns 500 with no controller constructed.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `grep -rn "console\." src/server/email src/app/api/receipts` returns nothing
- [ ] `grep -rn "console\." src/server src/app/api` returns nothing (every `console.*` migrated: the 11 domain sites + the trpc/inngest/inbound route roots + the `/api/health` probe root)
- [ ] Local Resend webhook replay (or the existing e2e path): stdout shows `email.inbound`-scoped lines with one `trace_id`, and a subsequent `outbox delivered` + `receipt.extract` line share it

---

## Phase 10: Infra + rules

Implements adr015 clause 1 (one project, all envs) on the infra side and the design's "Rules file" requirement.

### Changes
- `infrastructure/variables.tf:1-9` — add `variable "posthog_key" { type = string; sensitive = true; description = "PostHog project token (phc_…) for the Rekurve project; same value for production and preview." }`.
- `infrastructure/vercel.tf:55-72` — update the header comment (`:55-56`, "Only the Bedrock wiring lives here") to "Bedrock + PostHog wiring"; add to `local.vercel_env`: `POSTHOG_KEY = { value = var.posthog_key, sensitive = true }`, `POSTHOG_HOST = { value = "https://us.i.posthog.com", sensitive = false }`. The `for_each` at `:74-82` already targets `[var.environment]`, so both production and preview receive them.
- `.github/workflows/deploy.yml:42-83` (`terraform-apply` job) — add `TF_VAR_posthog_key: ${{ secrets.POSTHOG_KEY }}` to the job `env` next to `VERCEL_API_TOKEN` (`:56`). Owner adds the `POSTHOG_KEY` repository secret (manual step; the value is the `phc_` token from the Rekurve project settings).
- `.env.example` — **owner-edited, hook-protected**: add `POSTHOG_KEY=`, `POSTHOG_HOST=https://us.i.posthog.com`, `LOG_LEVEL=info` with one-line comments. The implementer lists these lines in the PR for the owner to paste.
- `.claude/rules/server-architecture.md` — two additions under "Construction rules" (or a new "Observability" bullet list): (a) "Services and repositories never call `captureException`. Exceptions are captured only at the three choke points — `onRequestError` (`src/instrumentation.ts`), the tRPC `tracingMiddleware`, and the Inngest `TracingMiddleware.onRunError`. Tiers log through their injected `logger.error`; spans `recordException`." (b) "Inngest handlers pick named fields from `event.data` (`event.data.receiptId`) and never spread or hash `event.data` — it carries the adr016 `_trace` pocket." Also add `logger: Logger` to the tier map's "Depends on" column for controller and service, and a row for `src/server/observability/` under the adapter tier ("shared provider adapter, like `blob-store/`; tiers see only `Logger` + the ambient OTel API").
- `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md`, `docs/adr/adr016-trace-context-in-outbox-payload.md` — leave `Status: 'Proposed'` until Phase 11 verifies the sinks; Phase 11 flips both to `Accepted`.

### Success
- [ ] `make check` passes
- [ ] `terraform -chdir=infrastructure validate` passes (`TF_VAR_posthog_key=phc_x` set for the local run)
- [ ] `terraform plan` for preview shows exactly two new `vercel_project_environment_variable` resources and no change to the existing three
- [ ] Rules file renders; `/security-review` (touches Terraform env wiring, `.env.example`, workflow secrets)

---

## Phase 11: Preview spike + alerts

Resolves the design's runtime unknowns (Risks 1, 2, 3, 4, 5, 8) against the fallbacks the design already chose, then creates the six v1 alerts. No new code unless a fallback triggers.

### Changes
- Deploy the branch to preview (deploy.yml runs `terraform-apply` for preview; the two env vars land). Trigger **one** Receipt via upload and **one** via email. Then check, in order:
  1. **Flush under `waitUntil`** (Risk 1): PostHog Traces shows the full chain `trpc.receipt.create` → `outbox.deliver` → `inngest.function.process-receipt` → `receipt.extract` → `ai.generateObject.doGenerate` on one `trace_id`; PostHog Logs filtered by that `trace_id` shows lines from `trpc`, `outbox`, `inngest`, `receipts`. If the tail is missing, `after(flushTelemetry)` is not firing on that route — fix the route, redeploy.
  2. **AI SDK v5 spans convert** (Risk 2): one `$ai_generation` exists with `$ai_trace_id` = the OTel trace id, `posthog.distinct_id` = the Member, `$ai_input` showing prompt text + the `<redacted image/jpeg N sha256:…>` stub, `$ai_output_choices` = the extracted JSON, non-null tokens. If absent → fallback per design: wrap the `LanguageModel` with `withTracing` in `src/server/inngest/functions.ts` **only** (the composition root), stamp `posthogTraceId` from the active span, delete at the v7 upgrade; record in adr015 consequences.
  3. **Cost** (Risk 3): `$ai_total_cost_usd` non-null → done. Null → set `BEDROCK_INPUT_TOKEN_PRICE_USD` / `BEDROCK_OUTPUT_TOKEN_PRICE_USD` in `local.vercel_env` (`infrastructure/vercel.tf:57-72`, values from the Bedrock pricing page for `au.anthropic.claude-sonnet-4-6`, non-sensitive) — the processor from Phase 2 already stamps them; add the two lines to the `.env.example` list for the owner.
  4. **`"auto"` semantics** (Risk 4): Vercel drains/`deployment.id`, `deployment.environment.name = preview`, git sha appear as resource attributes on the spans. If not, `"auto"` is not being honoured on 2.1.3 — re-read `node_modules/@vercel/otel` and fix `otel.ts`.
  5. **Bundling** (Risk 5): already settled by Phase 3's `make build`; confirm the preview function cold-starts without a module-resolution error in Vercel runtime logs.
  6. **`event_name`** (Risk 8): in PostHog Logs, check whether the `receipt.failed` / `trace.carrier.missing` records expose `EventName` as a filterable field. If yes → delete the `event.name` attribute mirror in `logger.ts` (keep the `eventName` field), update `logger.test.ts`, and point the alerts at `EventName`. If no → keep the mirror; alerts filter on `event.name`.
  7. **No leakage** (Risk 6): Vercel runtime logs / a one-off `console.log` of outbound headers is **not** needed — Phase 3's test covers our side; confirm no `baggage` header in Resend's inbound webhook request log for the download call if Resend exposes it; otherwise accept the unit test.
- Force one failure path each to seed Error Tracking: a hand-sent `receipt/retry` for a non-existent id (clean no-op — verify no issue), then a real parse failure (temporarily point `BEDROCK_RECEIPT_MODEL` at an invalid profile on preview) → one Error Tracking issue with `distinctId` + `$trace_id` from `onRunError`, and one `receipt.failed` log on the final attempt. Restore the model id.
- Create alerts (PostHog UI or `mcp__posthog__exec alert …`), all filtered `deployment.environment.name = production`, email destination:
  | Alert | Product | Rule |
  |---|---|---|
  | Receipt failed | Logs | `event.name=receipt.failed` (or `EventName`) ≥1 / 5 min |
  | Outbox stuck | Logs | `event.name=outbox.sweep.stuck` ≥1 |
  | Inbound webhook error | Logs | `domain=email severity=ERROR` ≥1 / 5 min |
  | Final Inngest failure | Error Tracking | new issue / spike |
  | Unhandled server error | Error Tracking | new issue |
  | Daily AI spend | Insight alert | sum `$ai_total_cost_usd` per day > threshold (owner sets the number) |
- `docs/adr/adr015-…md`, `docs/adr/adr016-…md` — flip `Status: 'Proposed'` → `'Accepted'`; fill each ADR's "Open Questions" with the answers found above (flush, v5 conversion, cost, `serverExternalPackages`, `EventName`); if a fallback fired, add the consequence note.
- `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` — in Links, replace "Runbook (TBD) … no observability backend yet" with a pointer to adr015 and the "Outbox stuck" alert.

### Success
- [ ] One trace id spans the upload path end to end in PostHog Traces, and Logs filtered by it show all four domains
- [ ] One trace id spans the email path end to end (`email.inbound` root)
- [ ] `$ai_generation` present with Member `distinct_id`, redacted image stub, extracted JSON, tokens; cost non-null (natively or via price attrs)
- [ ] Error Tracking shows the forced Inngest failure with `distinctId` + `$trace_id`
- [ ] Six alerts exist and are filtered to production
- [ ] Each of Risks 1–8 has a one-line recorded outcome in adr015/adr016 Open Questions; both ADRs read `Accepted`
- [ ] `make check` and `make test` pass on the final branch

---

## Follow-ups (post-plan)

Do these **after** the plan is fully implemented (Phase 11 done). Not blockers for this plan.

### F1: Inngest send→receive integration test harness

**Why.** Phase 5's middleware sets `"outbox.event_id": ctx.event.id`, assuming Inngest hands the function the same `id` we sent (the outbox row PK), so telemetry joins back to the `outbox` table. That hop runs on **Inngest's server** and is **not** covered by any test we can write today:
- **Unit tests can't** — the fake `ctx` sets `event.id` ourselves, so asserting it is circular.
- **`@inngest/test` can't** — it runs functions in-process with mocks, no real server, no `send()` round trip; you supply the event, so reading `ctx.event.id` back is the same circular test (confirmed against README, v4 docs, RFC #1680, JSR; also 0.x + not installed).
- Inngest's own docs are ambiguous: a sent `id` is documented as a **dedup key**, and `send()` returns **server-assigned ULIDs** — so `ctx.event.id` might be a ULID, not our PK. Only a real round trip settles it.

Our-side links are already unit-tested (`outbox.repository.test.ts:117` PK→row, `outbox.service.test.ts:106-120,216-233` PK→sent id, `inngest-middleware.test.ts:146` received id→`outbox.event_id`). The harness closes the one remaining hop and guards it against future Inngest releases.

**What to build.** An integration harness that boots the **Inngest Dev Server** (`inngest-cli`, already a devDep) + the app's `serve` endpoint, sends a real event with a known UUID `id`, polls for the run, and asserts the handler observed `ctx.event.id === <that UUID>` (and, more broadly, that a full send→receive→telemetry chain lands). Portless caveat: no ports locally, so the harness needs a reachable URL (the `portless proxy --port 1355` fallback, or a CI-only port). Keep it out of the fast `make test` unit path — its own target (e.g. `make test_integration`), opt-in / CI-gated, since it spawns processes.

**First assertion to add** (the one that motivated it): `outbox.event_id` from a real run equals the outbox row PK we sent — the log→row join Phase 5 depends on. Then generalise to guard the whole trace chain on Inngest upgrades.

> Interim: until F1 exists, Phase 5's `outbox.event_id` correctness is confirmed by a **one-time live run** (read the field on the first real upload; it must be the UUID PK, not a ULID). If it's a ULID, stamp the PK into the event `data` (alongside `_trace`) and read that instead — see Phase 5 notes.

### F2: Move domain ids onto baggage at the producer (de-leak the middleware)

**Why.** `TracingMiddleware` is generic Inngest infra but hardcodes a domain field: it reads `data.receiptId` and stamps `receipt.id` (see `src/server/observability/inngest-middleware.ts` `domainAttrs`). Every new domain that wants its id on spans/logs would add another branch here — a domain leak. `member.id` already avoids this: the producer sets it on baggage, it rides the `_trace` carrier, `restoreTraceCarrier` brings it back, and the middleware stays generic.

**What to build.** Make the receipt-create producers (tRPC `receipt.create`, Phase 6; inbound email route, Phase 9) set `receipt.id` on baggage **before** `buildOutboxEvent` mints the event, so it rides the carrier like `member.id`. Then delete `domainAttrs` and its two call sites from the middleware. Kept as a stopgap now (not a blocker) because removing it before those producers set baggage would drop `receipt.id` from receipt-run telemetry until Phase 6/9 land.

### F3: Drop Inngest's own `inngest.execution` root (adr016 clause 6)

**Why.** adr016 clause 6 says the timeline should show our `inngest.function.*` span under the producer, not Inngest's unrelated `inngest.execution` root. Inngest starts that root on the global tracer (adr016 Context), and `otel.ts:51` samples with `parentbased_always_on` and **no name-drop**, so the orphan root still exports to PostHog. **adr016 clause 6 is unmet** — this is the remaining gap before adr016 can be marked fully `Accepted`.

**What to build.** In the adr015 boot (`src/server/observability/otel.ts`), drop spans named `inngest.execution` — a name-filtering span processor (skip export on match) or a custom `Sampler` that returns `NOT_RECORD` for that name (mind the `parentbased` composition). Then live-verify in PostHog that the orphan root is gone and our function span sits under the producer. It's a sampler/processor change needing the live surface, so it's a follow-up, not part of the Phase 5 middleware.

---

## References

- Design doc: `thoughts/designs/2026-09-15-posthog-observability.md` (carries `## Related ADRs`)
- ADRs:
  - `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md` (Proposed) — implemented by Phases 1, 2, 3, 6, 7, 8, 9, 10; accepted in Phase 11
  - `docs/adr/adr016-trace-context-in-outbox-payload.md` (Proposed) — implemented by Phases 4, 5; accepted in Phase 11
  - Composes with (Accepted): `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` (outbox + sweep; "stuck"), `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (class DI, fakes as object literals), `docs/adr/adr014-bedrock-via-vercel-oidc.md` (aws4fetch, no AWS SDK instrumentation)
- Terminology: `CONTEXT.md` — Member (never "user"), Receipt, Channel, Household
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/bedrock-invocation.md:14`, `.claude/rules/jsdoc-concise.md`
- Code anchors: `src/server/inngest/events.ts:27-35`, `src/server/outbox/outbox.service.ts:102-114`, `src/server/inngest/client.ts:13-16`, `src/server/inngest/functions.ts:17-37`, `src/server/api/trpc.ts:88-134`, `src/server/receipts/receipts.service.ts:164-194,264-268`, `src/server/email/email.controller.ts:28-64`, `src/server/email/email.service.ts:89-125`, `src/app/api/trpc/[trpc]/route.ts:18-34`, `src/app/api/receipts/inbound/route.ts:20-51`, `src/app/api/inngest/route.ts:10-12`, `src/env.js:13-122`, `infrastructure/vercel.tf:57-82`, `infrastructure/variables.tf:1-9`, `.github/workflows/deploy.yml:42-83`
- Next 16 guides to read before Phases 3/6/7/9: `node_modules/next/dist/docs/03-api-reference/03-file-conventions/instrumentation.md`, `node_modules/next/dist/docs/01-app/02-guides/open-telemetry.md`, `node_modules/next/dist/docs/03-api-reference/04-functions/after.md`
- SDK sources to confirm during implementation: `node_modules/inngest/components/middleware/middleware.d.ts` (hook signatures), `node_modules/@vercel/otel` (`Configuration`, `"auto"`), `node_modules/@posthog/ai/dist/otel` (`PostHogSpanProcessor` ctor), `node_modules/@ai-sdk/otel` (`registerTelemetry`, `LegacyOpenTelemetry`; the `ai.prompt.messages`/`ai.generateObject` names redaction keys on — v7 moved this out of `node_modules/ai`)
