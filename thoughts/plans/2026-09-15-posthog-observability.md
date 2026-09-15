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
- Note for the implementer: AI SDK 5.0.252 passes `ai.prompt.messages` in the span's **start** attributes (`recordSpan` → `startActiveSpan(name, { attributes })`), so `onStart` sees it. Confirm on the installed `node_modules/ai/dist/index.mjs` before coding; if it turns out to be set post-start, move redaction to `onEnd` on the mutable `span.attributes` object — same tests, different hook.

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
- `src/server/observability/otel.ts` — new. Exports `registerObservability(): void`. Returns early when `!env.POSTHOG_KEY`. Otherwise `registerOTel({ serviceName: "personal-finance", propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()], traceSampler: <custom Sampler: span name === "inngest.execution" → NOT_RECORD, else RECORD_AND_SAMPLED>, spanProcessors: ["auto", new ContextSpanProcessor({ inputTokenPriceUsd: env.BEDROCK_INPUT_TOKEN_PRICE_USD, outputTokenPriceUsd: env.BEDROCK_OUTPUT_TOKEN_PRICE_USD }), posthogSpanProcessor, traceBatch], logRecordProcessors: [logBatch] })` where `posthogSpanProcessor = new PostHogSpanProcessor({ projectToken, host })` from `@posthog/ai/otel`, `traceBatch = new BatchSpanProcessor(new OTLPTraceExporter({ url: \`${host}/i/v1/traces\`, headers: { Authorization: \`Bearer ${key}\` } }), { scheduledDelayMillis: 1000, exportTimeoutMillis: 5000 })`, `logBatch = new BatchLogRecordProcessor(new OTLPLogExporter({ url: \`${host}/i/v1/logs\`, same headers }), same batch opts)`. Keep the three processor handles in a module-level `registered` record for `flush.ts`. `instrumentationConfig.fetch.propagateContextUrls: []` (or the equivalent on the installed 2.1.3 `Configuration`) so **no** outbound `traceparent`/`baggage` reaches Bedrock or Resend.
- `src/server/observability/flush.ts` — new. `export async function flushTelemetry(): Promise<void>` — `Promise.allSettled` over `traceBatch.forceFlush()`, `posthogSpanProcessor.forceFlush()`, `logBatch.forceFlush()`, `posthog-node` `flush()`; each wrapped in a 5 s timeout; never throws. No-op when nothing registered.
- `src/instrumentation.ts` — new. `export async function register() { if (process.env.NEXT_RUNTIME === "nodejs") { const { registerObservability } = await import("./server/observability/otel"); registerObservability(); } }`. `export const onRequestError: Instrumentation.onRequestError = async (error, request, ctx) => { captureException(error, { path: request.path, method: request.method, routerKind: ctx.routerKind, routeType: ctx.routeType }); await flushTelemetry(); }`. Also `createRootLogger().with({ domain: "next" }).error("unhandled route error", { error, ... })` so the Logs sink gets it too.
- `next.config.ts` — **only if** `make build` fails to bundle an OTel package: add the offending package(s) to `serverExternalPackages` (design Risk 5). Record what was needed in the PR.
- `src/server/observability/propagation.test.ts` — new. The one unit test in this phase: register a `NodeTracerProvider` with the same `traceSampler` and a `CompositePropagator([tracecontext, baggage])`; inside `context.with(setBaggage({ "member.id": "m1" }))` and an active span, assert `propagation.inject(context.active(), carrier)` **does** write `traceparent` + `baggage` (the outbox carrier relies on this) and that a `Headers` object built for an outbound `fetch` by our code gets **no** `baggage`/`traceparent` unless explicitly injected — i.e. the app never calls `inject` on outbound HTTP. Also assert the sampler returns `NOT_RECORD` for `inngest.execution` and `RECORD_AND_SAMPLED` for `outbox.deliver`.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes (`serverExternalPackages` added only if needed, and noted)
- [ ] `make start` with no `POSTHOG_KEY`: app boots, no OTel warnings, `registerOTel` not called
- [ ] `make start` with `POSTHOG_KEY` set: boot log shows the SDK registered once
- [ ] `/security-review` (touches `src/instrumentation.ts`, possibly `next.config.ts`)

---

## Phase 4: Trace carrier + outbox mint (`data._trace`)

Implements adr016 clauses 1 and 2 — `docs/adr/adr016-trace-context-in-outbox-payload.md`.

### Changes
- `src/server/observability/trace-carrier.ts` — new. `export interface TraceCarrier { traceparent?: string; tracestate?: string; baggage?: string }`; `export const TRACE_CARRIER_KEY = "_trace" as const`; `export function captureTraceCarrier(ctx = context.active()): TraceCarrier` → `propagation.inject(ctx, {})` (returns `{}` when no propagator/SDK); `export function restoreTraceCarrier(carrier: unknown): Context | null` — accept only a plain object with string values for the three keys, `propagation.extract(ROOT_CONTEXT, carrier)`, return `null` when the resulting span context is invalid (`trace.getSpanContext(ctx)` undefined or `!isSpanContextValid`).
- `src/server/inngest/events.ts:31-35` — hoist `const data = EVENT_REGISTRY[name].parse(payload)`; return `{ id, name, data: { ...data, [TRACE_CARRIER_KEY]: captureTraceCarrier() } }`. `OutboxEventDescriptor.data` stays `unknown` (`:24`). Registry schemas and keys untouched. JSDoc one-liner: the pocket is appended after parse so `z.object` stripping never removes it; nothing else writes it.
- `src/server/observability/trace-carrier.test.ts` — new. Register a `NodeTracerProvider` + `CompositePropagator([W3CTraceContextPropagator, W3CBaggagePropagator])` in the test. Slices: capture under an active span + `member.id` baggage yields `traceparent` (matching the span's trace id) and `baggage`; `restoreTraceCarrier(captured)` yields a Context whose span context has the same `traceId` and whose baggage has `member.id`; `restoreTraceCarrier({})`, `restoreTraceCarrier(undefined)`, `restoreTraceCarrier({ traceparent: "garbage" })`, `restoreTraceCarrier("string")` → `null`; capture with no active span → `{}`.
- `src/server/inngest/events.test.ts:9-15` — update the first case: `expect(event.data).toEqual({ receiptId: 1, _trace: expect.any(Object) })`; add a case: under an active span (register a provider in the test) `event.data._trace.traceparent` matches the trace id; add a case: `_trace` is present even when no SDK is registered (`{}`).
- `src/server/outbox/outbox.service.test.ts` — add one assertion in the `commit` path: the event handed to `inngest.send` carries `data._trace` (the descriptor the fake `events()` callback returned via `buildOutboxEvent` is sent byte-for-byte). Sweep path: a row whose `data` already holds `_trace` is re-sent with the same `_trace` (`outbox.service.ts:83-87` projects `row.data` verbatim).

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `registry-golden.test.ts` unchanged and green
- [ ] No Drizzle migration generated (`make db_generate` produces nothing; `pnpm run db:check` clean)

---

## Phase 5: Inngest `tracingMiddleware` + client wiring

Implements adr016 clauses 3–6 (restore, continue + link, missing pocket, drop Inngest's root) and adr015 clause 7's third choke point (`onRunError`) — `docs/adr/adr016-trace-context-in-outbox-payload.md`, `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md`.

### Changes
- `src/server/observability/inngest-middleware.ts` — new. `interface TracingMiddlewareDeps { logger: Logger; errors: Pick<typeof import("./posthog"), "captureException"> }` (an object with a method, not a bare fn — adr004) + `export class TracingMiddleware { private readonly logger; private readonly errors; constructor(deps: TracingMiddlewareDeps); get middleware(): InngestMiddleware }`. The getter builds `new InngestMiddleware({ name: "tracing", init: () => ({ onFunctionRun: ({ ctx, fn }) => ({ wrapFunctionHandler: …, onRunError: … }) }) })` closing over `this` — Inngest's hook API is itself closure-shaped, so this is the one place a closure is unavoidable; deps stay objects. Hook bodies:
  - `wrapFunctionHandler({ next })` (inspect the exact 4.19 signature in `node_modules/inngest/components/middleware/middleware.d.ts` — the hook receives the run `ctx` from `onFunctionRun`): `const parent = restoreTraceCarrier(ctx.event.data?._trace)`; if `null` → `this.logger.warn("trace carrier missing", { "event.name": "trace.carrier.missing", "inngest.function_id": fn.id(), "inngest.run_id": ctx.runId })` and `parent = ROOT_CONTEXT`. `const parentSpan = trace.getSpanContext(parent)`; start `inngest.function.<fn.id()>` via `tracer.startSpan(name, { links: parentSpan ? [{ context: parentSpan }] : [], attributes: { "inngest.run_id", "inngest.attempt", "inngest.function_id", "inngest.event_name": ctx.event.name } }, parent)`; `const runCtx = setBaggage({ "inngest.run_id": ctx.runId, "inngest.attempt": String(ctx.attempt), "outbox.event_id": ctx.event.id, "receipt.id": String(ctx.event.data?.receiptId) when present, "member.id": <from restored baggage, already in parent> }, trace.setSpan(parent, span))`; `return context.with(runCtx, next)` in a try/finally that ends the span; on throw `span.recordException`, `SpanStatusCode.ERROR`. The event object is **never** mutated.
  - `onRunError({ error, ctx? })` (exact shape from the `.d.ts`): `this.errors.captureException(error, { "inngest.function_id", "inngest.run_id", "inngest.attempt", isFinalAttempt: <attempt >= fn retries when exposed, else omit>, "receipt.id" })` and `this.logger.error("inngest run failed", { error, same attrs })`.
- `src/server/inngest/client.ts:13-16` — `new Inngest({ id: "personal-finance", eventKey: env.INNGEST_EVENT_KEY, logger: createRootLogger().with({ domain: "inngest" }), middleware: [new TracingMiddleware({ logger: createRootLogger().with({ domain: "inngest", component: "tracing" }), errors: { captureException } }).middleware] })`. Confirm the `logger` option's expected shape on 4.19 (it wants a `Logger`-like with `info/warn/error/debug`; `OtelLogger` satisfies it structurally — if not, pass an adapter object in `client.ts`, still no closures).
- `src/server/observability/inngest-middleware.test.ts` — new. Build the middleware with fake `logger` (records calls) and fake `errors` (records calls), register a test `NodeTracerProvider` + propagators + `InMemorySpanExporter`. Invoke the hooks directly with a hand-built `ctx` (`event`, `runId`, `attempt`) and a fake `fn` (`id: () => "process-receipt"`), `next` = a spy that captures `context.active()` and `trace.getSpan(...)`. Slices: (1) with a valid `_trace`, the started span shares the producer's `traceId`, its parent is the producer span, and it carries one link to the producer span context; (2) `next()` ran with baggage `inngest.run_id`, `inngest.attempt`, `outbox.event_id`, `receipt.id`, and the producer's `member.id`; (3) the `event` object passed in is deep-equal to what `next` observed (`_trace` still present, nothing rewritten); (4) missing `_trace` → span is a new root, `logger.warn` called once with `event.name: "trace.carrier.missing"`, handler still ran; (5) malformed `_trace` → same as (4); (6) `next` throws → span status ERROR + exception recorded, error rethrown; (7) `onRunError` → `errors.captureException` called with `inngest.*` attrs and `logger.error` called.
- `src/server/inngest/registry-golden.test.ts:26-53` — **unchanged**; it constructs controllers with a spy client, not `client.ts`, so the middleware never enters it. Confirm green.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make start` + Inngest dev server: a hand-sent `receipt/retry` event from the Inngest dashboard (no `_trace`) runs to completion and logs one `trace.carrier.missing` warn — never fails the run
- [ ] A real upload produces a run whose stdout log lines all carry the same `trace_id` as the tRPC request line
- [ ] Known consequence: with no `POSTHOG_KEY` locally, every run logs `trace.carrier.missing` once (no propagator registered, so the producer wrote `{}`). Accepted per design Decision 13.

---

## Phase 6: tRPC `devLatencyMiddleware` + `tracingMiddleware`, tRPC route flush, shared-root logger migration

Implements adr015 data-flow step 1 and clause 7's second choke point, Decision 16 (dev latency stays, outside the span). Also migrates the four non-domain `console.*` sites that have no DI seam — they construct a root `OtelLogger` directly, exactly as route files do (design: "Route files and `onRequestError` use `OtelLogger` directly (they are roots)").

### Changes
- `src/server/api/trpc.ts:88-103` — **characterization first**: add `src/server/api/trpc.test.ts` asserting the current `timingMiddleware` behaviour on a caller built from `createTRPCRouter` (dev → resolves after ≥100 ms; non-dev → resolves immediately; result passes through). Then split: `devLatencyMiddleware` = the `:91-95` sleep only, guarded by `t._config.isDev`; `tracingMiddleware` = `tracer.startActiveSpan(\`trpc.${path}\`, { attributes: { "trpc.type": type, "trpc.path": path } }, async (span) => { const ctx = setBaggage({ "member.id": ctx.session?.user?.id }); return context.with(ctx, async () => { const result = await next(); if (!result.ok) { span.setAttribute("trpc.error_code", result.error.code); span.recordException(result.error); span.setStatus(ERROR); if (result.error.code === "INTERNAL_SERVER_ERROR") { captureException(result.error, { "trpc.path": path }); logger.error("trpc internal error", { error: result.error, "trpc.path": path }) } else { logger.warn("trpc request failed", { "trpc.path": path, "trpc.error_code": result.error.code }) } } return result }) })` with `span.end()` in `finally`. Delete the `:100` `console.log`; the span carries duration. Module-level `const logger = createRootLogger().with({ domain: "trpc" })` (this file is core wiring, a root). Chain: `:112` `publicProcedure = t.procedure.use(devLatencyMiddleware).use(tracingMiddleware)`; `:122` `protectedProcedure = t.procedure.use(devLatencyMiddleware).use(tracingMiddleware).use(<auth>)`. Note `tracingMiddleware` reads `ctx.session` (set by `createTRPCContext` `:29-38`) so the Member is on baggage before the auth check.
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
- `src/server/outbox/outbox.service.ts:27-43` — `OutboxServiceDeps` gains `logger: Logger`; store `private readonly logger`. Constants at top: `STUCK_AFTER_MS = 60 * 60 * 1000` (one sweep interval — `outbox.controller.ts:26` cron is hourly). `deliver` (`:102-114`) wraps the send in `tracer.startActiveSpan("outbox.deliver", { attributes: { "outbox.event_id": event.id, "outbox.event_name": event.name, "outbox.delivery_context": context } }, ...)` inside `context.with(setBaggage({ "outbox.event_id": event.id }))`; on send failure `recordException` + ERROR. `sweep` (`:75-93`) per row: `tracer.startActiveSpan("outbox.sweep.row", { attributes: { "outbox.event_id": row.id, "outbox.attempts": row.attempts, "outbox.age_s": ageS } })`; when `ageS * 1000 >= STUCK_AFTER_MS` → `this.logger.warn("outbox row stuck", { "event.name": "outbox.sweep.stuck", "outbox.event_id": row.id, "outbox.event_name": row.name, "outbox.attempts": row.attempts, "outbox.age_s": ageS })` (computed from `row.createdAt`, `OutboxRow` at `outbox.repository.ts:9`). `ack` `:123` → `this.logger.error("outbox ack failed", { error, "outbox.event_id": id, "outbox.delivery_context": context })`; `recordFailure` `:132` → `this.logger.error("outbox delivery failed", { error, ... })`; `:137` → `this.logger.error("outbox failure-record failed", { error: recordError, ... })`. Also `this.logger.info("outbox delivered", { "outbox.event_id", "outbox.event_name", "outbox.delivery_context" })` after a successful ack — one line per delivery, the operational heartbeat.
- `src/server/outbox/outbox.module.ts:10-13` — bind `logger: createRootLogger().with({ domain: "outbox", component: "service" })`.
- `src/server/outbox/outbox.service.test.ts:27-70` — harness gains a fake `logger: Logger` (object literal recording `{ level, msg, attrs }` into an array; `with()` returns itself after recording bound attrs). Replace the `console.error` asserts at `:160`, `:241` with assertions on the recorded `error` entries (msg + `outbox.event_id`). New slices: successful delivery logs one `info`; a sweep row aged ≥ 1 h logs exactly one `warn` with `event.name: "outbox.sweep.stuck"` and `outbox.age_s`; a row aged 5 min logs no stuck warn; spans: register an `InMemorySpanExporter` in the harness and assert one `outbox.deliver` span per send with `outbox.event_id`, and one `outbox.sweep.row` per swept row.
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

### Changes
- `src/server/receipts/receipts.service.ts:132-153` — `ReceiptsServiceDeps` gains `logger: Logger`. `process()` (`:164-194`): wrap the body after the status guard in `tracer.startActiveSpan("receipt.extract", { attributes: { "receipt.id": receiptId, "receipt.channel": receipt.channel, "receipt.is_final_attempt": isFinalAttempt } }, ...)` inside `context.with(setBaggage({ "receipt.id": String(receiptId), "member.id": receipt.userId }))` (confirm the column name on `receipts.schema.ts` — the Member FK; `email.service.ts:121` calls it `sender.userId`). Outcomes as span attrs: `receipt.outcome` = `processed` | `duplicate` | `failed` | `retry`. Catch (`:184-193`): retryable + not final → `this.logger.warn("receipt extraction retrying", { error, "receipt.id", "receipt.channel", "receipt.is_final_attempt" })`, span status ERROR, rethrow; park path → `this.logger.error("receipt extraction failed", { error, "event.name": "receipt.failed", "receipt.id", "receipt.channel", "receipt.is_final_attempt", "receipt.reason": memberFacingError(error) })` replacing `:191`, then `markFailed` (`:192`). Values reuse the code's words: `ReceiptStatus.Failed` → `receipt.failed`.
- `src/server/receipts/receipts.service.ts:264-268` — `generateObject({ model, schema, messages, experimental_telemetry: { isEnabled: true, recordInputs: true, recordOutputs: true, functionId: "receipt.extract" } })`. No `metadata` (PostHog drops `ai.telemetry.metadata.*` — correlation comes from baggage via the processor).
- `src/server/inngest/functions.ts:22-28` — `new ReceiptsService({ ..., logger: createRootLogger().with({ domain: "receipts", component: "service" }) })`.
- `src/server/receipts/receipts.service.test.ts:59-141` — harness gains the fake `logger` (same shape as Phase 7) and an `InMemorySpanExporter`. Replace the `console.error` spies at `:271`, `:288`, `:352` with assertions on recorded `error` entries. New slices: parked receipt → exactly one `error` with `event.name: "receipt.failed"` and `receipt.id`; retryable-not-final → one `warn`, no `receipt.failed`, error rethrown; duplicate path → span `receipt.outcome = duplicate`, no error log; the stub `languageModel` path already used (`{} as LanguageModel`) keeps `generateObject` un-invoked in the guard/duplicate tests — for the telemetry option, add one test with a `MockLanguageModelV2` (from `ai/test`) asserting the `receipt.extract` span exists and that an `ai.generateObject` child span is present under the same trace (the SDK emits it on the global tracer registered by the test provider).
- `src/server/receipts/receipts.controller.ts:46-49` — no change; `isFinalAttempt` already flows. Test `receipts.controller.test.ts:5-37` unchanged.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `grep -rn "console\." src/server/receipts` returns nothing
- [ ] `make start` + Inngest dev + a real upload (with AWS creds via `assume`): stdout shows `receipt.extract` span-bearing log lines, and forcing a parse failure (e.g. temporarily invalid `BEDROCK_RECEIPT_MODEL`) logs `event.name=receipt.failed` on the final attempt
- [ ] `registry-golden.test.ts` unchanged and green

---

## Phase 9: Email domain observability + inbound route flush

Implements adr015 clause 3 (`email.inbound` span, `member.id` on resolve, `receipt.id` after insert), clause 8 (route flush), and the "Inbound webhook error" alert's log signal (`domain=email severity=ERROR`).

### Changes
- `src/server/email/email.controller.ts:22-26` — `EmailControllerDeps` gains `logger: Logger`. `handle()` (`:28-64`): after signature verification succeeds (`:49`) open `tracer.startActiveSpan("email.inbound", { attributes: { "email.id": parsed.data.data.email_id, "email.event_type": parsed.data.type } })` around parse + `ingest` (`:51-63`); the pre-verify path stays unlogged and span-less by design (`:45-48` — a rejected caller learns nothing, and we don't want unauthenticated noise in traces). If `ingest` throws: `span.recordException`, ERROR, `this.logger.error("inbound email failed", { error, "email.id" })`, rethrow (the 5xx still earns the Svix retry).
- `src/server/email/email.service.ts:67-83` — `EmailServiceDeps` gains `logger: Logger`. `ingest()` (`:89-125`): once `sender` resolves (`:91`) run the rest inside `context.with(setBaggage({ "member.id": sender.userId }))`; `:96` `console.info` → `this.logger.info("inbound email dropped: unknown sender", { "email.id": event.data.email_id, "email.from_domain": <domain part only — never the full address, a Member identifier> })`; `:114` `console.warn` → `this.logger.warn("inbound email attachments resolved to nothing", { "email.id", "email.qualifying": qualifying.length })`; after `createPendingReceipts` (`:120-123`) `this.logger.info("inbound email ingested", { "email.id", "receipt.ids": receiptIds })` and `trace.getActiveSpan()?.setAttribute("receipt.ids", receiptIds)`.
- `src/app/api/receipts/inbound/route.ts:20-51` — `compose()` binds `logger: rootLogger.with({ domain: "email", component: "controller" })` and `.with({ component: "service" })`; `POST` calls `after(flushTelemetry)` first; the `:46-49` `console.error` → `rootLogger.with({ domain: "email", component: "route" }).error("Resend credentials are not configured", { "event.name": "email.route.unconfigured" })` — still returns 500.
- `src/server/email/email.controller.test.ts` — harness gains fake `logger`; add: `ingest` throws → `logger.error` once with `email.id`, response rejects (existing behaviour); an `InMemorySpanExporter` shows one `email.inbound` span for a verified event and none for a 401.
- `src/server/email/email.service.test.ts:261` — replace the console assert with the recorded `info`/`warn` entries; add: unknown sender log carries `email.from_domain` and **not** the full `from`; ingested path logs `receipt.ids`.
- `src/app/api/receipts/inbound/route.test.ts:6-91` — mocks already stub the tier modules; add `vi.mock("~/server/observability/flush", ...)` and assert `flushTelemetry` is scheduled via `after` (mock `next/server` `after` to invoke synchronously). Assert the 500 path still returns 500 with no controller constructed.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `grep -rn "console\." src/server/email src/app/api/receipts` returns nothing
- [ ] `grep -rn "console\." src/server src/app/api` returns nothing (all 11 sites + both route sites migrated)
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
- SDK sources to confirm during implementation: `node_modules/inngest/components/middleware/middleware.d.ts` (hook signatures), `node_modules/@vercel/otel` (`Configuration`, `"auto"`), `node_modules/@posthog/ai/dist/otel` (`PostHogSpanProcessor` ctor), `node_modules/ai/dist/index.mjs` (`ai.prompt.messages` set at span start)
