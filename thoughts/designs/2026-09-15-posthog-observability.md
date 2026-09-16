---
date: 2026-09-15
topic: PostHog observability — OTel traces, logs, LLM analytics, error tracking, with one trace id from HTTP entry through the outbox to the Inngest worker
status: Draft design — ready for /write-plan or /write-tickets
---

# PostHog observability: traces, logs, LLM analytics, errors

## Problem

Today the server writes 15 `console.*` lines across 10 files and nothing else.
When a receipt fails there is no way to see, in one place, the tRPC call or
inbound email that created it, the outbox delivery, the Inngest attempts, the
Bedrock prompt and response, tokens and cost, and the error. There are no
alerts. The same gap will apply to the future CDR bank sync and reconciliation
jobs.

Required outcome:

- **One trace id** follows a piece of work from `POST /api/trpc/*` or
  `POST /api/receipts/inbound` through the outbox row into every Inngest
  attempt and the Bedrock call.
- **Logs** carry that trace id plus domain context (`member.id`, `receipt.id`,
  `outbox.event_id`) and are searchable by severity and attribute.
- **LLM analytics** show the full prompt text, the extracted JSON, tokens, cost,
  and which Member drove the spend.
- **Failures alert.** Parked receipts, stuck outbox rows, webhook errors,
  final Inngest failures, unhandled server errors, daily AI spend.
- Product analytics, feature flags and session replay come later on the same
  PostHog project, so the design must not block them.

## Verified facts

Local checks against `node_modules` and the registry, and doc lookups, all on
2026-09-15. See [Evidence](#evidence) for sources.

- Stack: Next.js 16.3.4 App Router on Vercel, Node 24.x (`engines`, `.nvmrc`,
  `vercel.tf`), `ai` 5.0.252, `@ai-sdk/amazon-bedrock` 3.0.129, Inngest 4.19.0.
  No edge routes, no `proxy.ts`.
- `@ai-sdk/amazon-bedrock` signs with `aws4fetch` and calls `/converse` over
  `fetch`. It does **not** use `@aws-sdk/client-bedrock-runtime`, so PostHog's
  AWS Bedrock install page (AWS SDK instrumentation) cannot see our calls.
- `ai` 5.0.252 `generateObject` accepts `experimental_telemetry
  { isEnabled, recordInputs, recordOutputs, functionId, metadata, tracer }`
  and emits `ai.generateObject` / `ai.generateObject.doGenerate` spans with
  `ai.prompt.messages`, `ai.response.object`, `ai.usage.*`, `gen_ai.request.model`.
  `stringifyForTelemetry` inlines file bytes as **base64** into
  `ai.prompt.messages`. `generateObject` is not deprecated in v5.
- Current ai-sdk.dev docs (v7) rename the option to `telemetry`, add
  `registerTelemetry` + `@ai-sdk/otel`, and deprecate `generateObject`.
- `@vercel/otel` latest is **2.1.3** (1.14.2 is the `otel-sdk-1` tag). v2 peers
  on OTel SDK v2 (`sdk-trace-base >=2 <3`, `sdk-logs >=0.200 <0.300`,
  `api >=1.9 <2`). `registerOTel` accepts `serviceName, attributes,
  instrumentations, instrumentationConfig, propagators, traceSampler,
  spanProcessors, traceExporter, logRecordProcessors, metricReaders, ...`.
  A custom `spanProcessors` list **replaces** Vercel's chain unless `"auto"`
  is included. Vercel's chain flushes via `waitUntil`; flush of custom
  processors alongside it is not documented.
- `@posthog/ai` 8.11.1: `PostHogSpanProcessor` from `@posthog/ai/otel` takes
  `{ projectToken, host }`, keeps spans whose name or attribute keys start with
  `gen_ai.`, `llm.`, `ai.`, `traceloop.`, batches them to `/i/v0/ai/otel`, and
  exposes `forceFlush()` / `shutdown()`. Peers: `sdk-trace-base ^2.0.0`,
  `exporter-trace-otlp-http >=0.200`. `withTracing` still exists with
  `posthogDistinctId, posthogTraceId, posthogProperties, posthogPrivacyMode,
  posthogGroups, posthogCaptureImmediate, posthogModelOverride,
  posthogProviderOverride, posthogCostOverride`, but PostHog states it
  "supports the v5 and v6 provider interfaces and rejects v7 models".
  `captureAiGeneration` is also exported.
- PostHog OTel AI path: identity and grouping are **span attributes**
  `posthog.distinct_id`, `$ai_session_id`, `$ai_trace_name`, `$groups`
  (JSON string). "PostHog forwards span attributes it does not recognize onto
  the event." Vercel AI SDK `experimental_telemetry.metadata` arrives as
  `ai.telemetry.metadata.*` and is dropped (PostHog/posthog#52442).
- PostHog OTel AI caps: **4 MB per export** (HTTP 413, whole batch lost, not
  retried) and **8 MB per event** (span dropped silently). No redaction or
  privacy mode is documented on the OTel path.
- PostHog cost: OpenRouter pricing with a manual fallback DB. Matching rules,
  Bedrock inference-profile ids and `$ai_provider` values for Bedrock are not
  documented. Documented per-event overrides: `$ai_input_token_price`,
  `$ai_output_token_price`, `$ai_input_cost_usd`, `$ai_output_cost_usd`.
- PostHog Logs: OTLP to `/i/v1/logs`, filter by severity, service, resource and
  custom attributes. **Log alerts** exist: threshold on filters, checked every
  5 min, N-of-M noise control, destinations. 14-day retention.
- PostHog traces: OTLP to `/i/v1/traces`, `Authorization: Bearer <phc_…>`.
- Inngest 4.19: does not extract the incoming `traceparent` into OTel context
  and does not propagate the sender's trace from `inngest.send`. It starts its
  own `inngest.execution` root span on the global tracer per execution request.
  Middleware hooks include `wrapFunctionHandler`, `onRunError`, `wrapRequest`.
  Handler `process-receipt` calls `service.process` directly, no `step.run`, so
  there is no memoisation replay.
- `buildOutboxEvent` returns `{ id, name, data: schema.parse(payload) }`.
  Registry schemas are plain `z.object` (unknown keys stripped). The outbox row
  stores `data jsonb` only.
- `timingMiddleware` in `trpc.ts` sleeps 100–500 ms when `t._config.isDev` and
  `console.log`s the duration.
- Model id is `au.anthropic.claude-sonnet-4-6` via `BEDROCK_RECEIPT_MODEL`
  (Terraform-owned, `src/env.js` default).
- Existing PostHog project: "Rekurve" (US cloud), product analytics onboarded,
  session replay and exception autocapture enabled.
- OTel Logs data model has a stable top-level `EventName` field; the semconv
  `event.name` attribute is deprecated in its favour. `@opentelemetry/api-logs`
  exposes `LogRecord.eventName` since 0.202.0; `otlp-transformer` at tag
  `experimental/v0.222.0` emits `eventName: log.eventName`; proto field
  `event_name = 12` since opentelemetry-proto v1.5.0. PostHog Logs documents
  filtering and alerting on log and resource attributes; `EventName` is not
  mentioned in its docs.

## Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| 1 | Transport | `@vercel/otel` 2.1.3 over OTel SDK v2 | Raw `NodeSDK` | Same SDK line as `@posthog/ai` and Inngest. Logs supported. Vercel resource attrs, drains and `waitUntil` flush for free. Exit cost is one file. |
| 2 | LLM analytics path | OTel `PostHogSpanProcessor` fed by AI SDK telemetry | `withTracing` | `withTracing` rejects v7 models and the v7 upgrade is planned. Same trace id in APM and LLM views. |
| 3 | Producer → Inngest trace relation | **Continue and link** (C) | Continue only; new trace + link only | One trace id end to end today; the link makes a later switch to per-run traces a one-line change. |
| 4 | Trace carrier across the outbox | `data._trace` = propagator output (`traceparent`, `tracestate`, `baggage`) appended after schema parse; never stripped | New outbox column; inject at `wrapSendEvent` | No migration, survives `data jsonb` and sweep re-delivery, registry keys untouched. Inngest v4 hooks are read-only. |
| 5 | Correlation context | OTel **Baggage** + `ContextSpanProcessor` | Explicit `RequestContext` param; span attrs only | Ambient, so adr004 classes stay singletons. Serialises next to `traceparent`. Children inherit. |
| 6 | Logger | Injected `Logger` interface with `with(attrs)` | Ambient singleton; keep `console.*` | Fits "deps are objects with methods", fakes are object literals, no module mocking. |
| 7 | Log mirroring | OTel record **and** one JSON line to stdout | OTel only | Vercel runtime logs stay as the fallback if export fails. |
| 8 | Span scope | Entry-point spans + ~5 named business spans | Entry only; everything incl. DB | `outbox.deliver`, `receipt.extract` etc. are the units you alert on. postgres-js has no instrumentation. |
| 9 | Tracer access in services | Ambient `@opentelemetry/api` tracer | Injected `Tracer` port | OTel standard; no-op without an SDK, so tests need no fakes. |
| 10 | `$ai_input` content | Prompt text kept, image `data` **redacted** by our processor | `recordInputs: false`; full capture | Base64 receipt breaks the 4 MB export cap. Redaction is version-independent. |
| 11 | Cost for inference-profile ids | Spike first; fallback stamps `$ai_*_token_price` from Terraform env | Guess PostHog's matcher | Documented override, no reliance on undocumented normalisation. |
| 12 | Error capture | `posthog-node` `captureException` at 3 choke points + span errors | Logs only; capture in every `catch` | Issue grouping and alerts without infra calls in services. |
| 13 | Environments | One project, all envs, filter on `deployment.environment.name` | Two projects; prod only | Preview exercises the pipe before the promote gate; dev sends only when the key is set. |
| 14 | Sampling | 100 %, drop `inngest.execution` by name | Ratio sampling | Pre-PMF volume fits free tiers. |
| 15 | Flush | One `flushTelemetry()` via `after()` in the three API route files | Rely on `@vercel/otel` | Custom processor flush under `waitUntil` is undocumented. |
| 16 | Dev latency | Keep as `devLatencyMiddleware`, before the tracing span | Drop it | Waterfall detection still matters locally; span durations stay honest. |
| 17 | Alertable log event key | OTel `eventName` field **and** `event.name` attribute mirror; values `receipt.failed`, `outbox.sweep.stuck` | Bare `event` attribute; field only; attribute only | `eventName` is the stable OTel home and the 0.222 exporter serialises it; PostHog Logs filters on attributes but does not document `EventName`. Values reuse the code's words (`ReceiptStatus.Failed`, adr002 "stuck"). |

## Architecture

One OTel SDK, three PostHog sinks plus `posthog-node`, one project.

```
                     src/instrumentation.ts  (nodejs runtime only)
                                │  dynamic import
                                ▼
              src/server/observability/otel.ts  → registerOTel({
   resource: service.name=personal-finance + Vercel auto attrs
   propagators: tracecontext, baggage          (no outbound propagation)
   traceSampler: always-on, drop name "inngest.execution"
   spanProcessors: [
     "auto",                         → Vercel chain (drains, waitUntil flush)
     ContextSpanProcessor,           → baggage → attrs, posthog.distinct_id,
                                        image redaction, price attrs
     PostHogSpanProcessor,           → ai.* spans → /i/v0/ai/otel ($ai_generation)
     Batch(OTLP JSON trace exporter) → /i/v1/traces (APM timeline)
   ],
   logRecordProcessors: [ Batch(OTLP JSON log exporter) → /i/v1/logs ],
})
              src/server/observability/posthog.ts → posthog-node (captureException only)
```

- All sinks use the `phc_` token from `POSTHOG_KEY`. No key: `registerOTel` is
  skipped, the logger writes stdout only, `captureException` is a no-op.
- `onRequestError` in `instrumentation.ts` calls `captureException` then
  `flushTelemetry()`.
- App code never imports setup. Services depend on an injected `Logger` and the
  ambient `@opentelemetry/api` tracer.

## Data flow: one receipt

1. **Entry.** Next opens the HTTP root span. `devLatencyMiddleware` (dev only)
   then `tracingMiddleware` opens `trpc.<path>`, sets baggage
   `member.id = ctx.session.user.id`, records `trpc.type`, `trpc.path`, status,
   `TRPCError.code`. Webhook: `EmailController.handle` opens `email.inbound`,
   sets `member.id` when the sender resolves and `receipt.id` after insert.
2. **Mint.** `buildOutboxEvent` parses the payload, then appends
   `data._trace = captureTraceCarrier()`, the propagator's carrier output
   (`traceparent`, `tracestate` when present, `baggage`). Stored in
   `data jsonb`. Registry keys and schemas unchanged.
3. **Deliver.** `OutboxService.deliver` opens `outbox.deliver`
   (`outbox.event_id`) and calls `inngest.send`. A failed send is re-sent by
   `outbox-sweep` with the same `_trace`, so the late run joins the original
   trace. `outbox.sweep.row` spans per row; a row still unacked after one
   sweep interval (1 h) logs `event.name=outbox.sweep.stuck` with
   `outbox.attempts` and `outbox.age_s`. "Stuck" is adr002's word; the sweep has no attempts
   cap, so age is the actionable predicate.
4. **Run.** Inngest middleware `wrapFunctionHandler` restores the carrier,
   opens `inngest.function.<id>` as a **child** of the producer span **with a
   link** to it, sets baggage (`inngest.run_id`, `inngest.attempt`,
   `outbox.event_id`, `receipt.id`, `member.id` from the carrier), and runs
   `next()` inside `context.with`. The event is **not** rewritten: Inngest v4
   hooks are read-only, `event.data` is `any`, and handlers pick fields by
   name. Each retry repeats this under the same trace.
5. **Extract.** `ReceiptsService.process` opens `receipt.extract`
   (`receipt.id`, `receipt.channel`, `isFinalAttempt`). `generateObject` with
   `experimental_telemetry { isEnabled: true, functionId: "receipt.extract" }`
   emits `ai.generateObject.doGenerate`. `ContextSpanProcessor` redacts the
   image and stamps `posthog.distinct_id`. Both sinks receive it: one
   `$ai_generation` with `$ai_trace_id` = OTel trace id, one span in the APM
   timeline.
6. **Logs.** Every `logger.*` call carries `trace_id`, `span_id`, the baggage
   keys, and the `with()` domain context. Filter Logs by `trace_id` to read the
   whole story.

## Components

Folder `src/server/observability/`, a shared provider adapter like
`blob-store/` and `aws/`.

| File | Owns |
|---|---|
| `logger.ts` | `interface Logger { debug, info, warn, error, with(attrs): Logger }`. `class OtelLogger`: OTel log record (severity, body, bound attrs, baggage attrs, `exception.type/message/stacktrace` on `error`; an `event.name` attribute is lifted onto the record's `eventName` field and kept as an attribute), mirrored as one JSON line to stdout (pretty in dev), `LOG_LEVEL` filter. |
| `baggage.ts` | Key constants `member.id`, `receipt.id`, `outbox.event_id`, `inngest.run_id`, `inngest.attempt`; `setBaggage(attrs)`, `readBaggage()` over `@opentelemetry/api`. |
| `span-processor.ts` | `class ContextSpanProcessor implements SpanProcessor`. `onStart`: baggage → attrs; `member.id` → `posthog.distinct_id`; on `ai.*` spans parse `ai.prompt.messages`, replace each file part `data` with `<redacted <mediaType> <size> sha256:<hash>>`, set `$ai_input_token_price` / `$ai_output_token_price` when configured. Other hooks no-op. |
| `trace-carrier.ts` | `captureTraceCarrier(): TraceCarrier` and `restoreTraceCarrier(carrier): Context`. Used by `buildOutboxEvent` and the Inngest middleware. |
| `inngest-middleware.ts` | `tracingMiddleware` (`InngestMiddleware`): `wrapFunctionHandler` as in Data flow step 4; `onRunError` → `captureException` + span error. |
| `posthog.ts` | `posthog-node` singleton; `captureException(err, attrs)` adds `distinctId` from baggage and `$trace_id` / `$span_id`. |
| `otel.ts` | `registerOTel` composition. Boot code. |
| `flush.ts` | `flushTelemetry()`: `forceFlush` on the trace batch, `PostHogSpanProcessor`, the log batch, `posthog-node`. Batch delay 1 s, export timeout 5 s. |

**Tier changes**

- `ReceiptsService`, `OutboxService`, `EmailService`, `EmailController`,
  `ReceiptsController` gain `logger: Logger` in deps. Composition roots bind
  `logger.with({ domain, component })`.
- All 15 `console.*` sites migrate in this change. Route files and
  `onRequestError` use `OtelLogger` directly (they are roots).
- `trpc.ts`: `timingMiddleware` → `devLatencyMiddleware` (sleep only, `isDev`)
  chained **before** `tracingMiddleware`, so fake latency sits outside the span.
  The `console.log` line goes; the span carries the duration.
- `client.ts`: `new Inngest({ id, eventKey, logger, middleware: [tracingMiddleware] })`.
- `events.ts`: `buildOutboxEvent` appends `_trace`.
- The three API route files (`trpc/[trpc]`, `receipts/inbound`, `inngest`) call
  `after(flushTelemetry)`.
- Unchanged: repositories, schemas, `EVENT_REGISTRY` keys, function ids,
  triggers, `registry-golden.test.ts`.

**Rules file**

- `.claude/rules/server-architecture.md` gains two lines in the same PR, so
  the agent rules match the code: (a) services and repositories never call
  `captureException`; exceptions are captured only at the three choke points
  (`onRequestError`, tRPC middleware, Inngest `onRunError`) and services log
  through `logger.error`; (b) handlers pick named fields from `event.data`,
  never spread it (adr016 clause 4).

**Env and infra**

- `src/env.js` server schema, all optional: `POSTHOG_KEY` (`phc_` prefix,
  refuse `phx_`), `POSTHOG_HOST` default `https://us.i.posthog.com`,
  `LOG_LEVEL` default `info`. Later: `BEDROCK_INPUT_TOKEN_PRICE_USD`,
  `BEDROCK_OUTPUT_TOKEN_PRICE_USD` if the cost spike needs them.
- Terraform `local.vercel_env` writes `POSTHOG_KEY`, `POSTHOG_HOST` for
  production + preview. Local dev sets them by hand. `.env.example` is edited
  manually by the owner.
- Pinned exact deps: `@vercel/otel` 2.1.3, `@opentelemetry/api` 1.9.x,
  `@opentelemetry/api-logs` / `sdk-logs` / `exporter-trace-otlp-http` /
  `exporter-logs-otlp-http` / `instrumentation` 0.222.0,
  `@opentelemetry/sdk-trace-base` / `resources` / `sdk-metrics` 2.11.0,
  `@posthog/ai` 8.11.1, `posthog-node` 5.52.2.

## LLM analytics

Each Bedrock call → one `$ai_generation`: `$ai_model =
au.anthropic.claude-sonnet-4-6`, `$ai_provider` as reported by the AI SDK,
tokens, latency, `$ai_input` (prompt text with the image stub),
`$ai_output_choices` (extracted JSON), `posthog.distinct_id` = Member,
`$ai_trace_id` = OTel trace id, plus forwarded attrs `receipt.id`,
`receipt.channel`, `inngest.attempt`, `functionId = receipt.extract`.

- Cost per Member: trends insight on `$ai_total_cost_usd` by person.
- Cost per Household: later, a `household.id` baggage key → `$groups`.
- If the spike shows `$ai_total_cost_usd` null, the processor stamps
  `$ai_input_token_price` / `$ai_output_token_price` from the two Terraform env
  vars.
- Retention: PostHog strips large `$ai_*` props after 30 days. Extracted receipt
  JSON is member financial data inside our own project. Accepted for pre-PMF.

## Error handling and alerts

Three capture points, none in service `catch` blocks:

1. `onRequestError` → unhandled route errors.
2. `tracingMiddleware` → `TRPCError` with `INTERNAL_SERVER_ERROR` → issue.
   Other codes → span status + `warn` log only.
3. Inngest `onRunError` → every failed attempt, properties `inngest.attempt`,
   `isFinalAttempt`, `receipt.id`.

Each issue carries `distinctId` and `$trace_id`. Spans always
`recordException` + `ERROR` status.

Alerts v1, all filtered to `deployment.environment.name = production`, email
destination:

| Alert | Product | Rule |
|---|---|---|
| Receipt failed | Logs | `event.name=receipt.failed` ≥1 / 5 min |
| Outbox stuck | Logs | `event.name=outbox.sweep.stuck` ≥1 |
| Inbound webhook error | Logs | `domain=email severity=ERROR` ≥1 / 5 min |
| Final Inngest failure | Error Tracking | new issue / spike |
| Unhandled server error | Error Tracking | new issue |
| Daily AI spend | Insight alert | sum `$ai_total_cost_usd` per day > threshold |

Alertable log records name their kind, never by message text. The call site
passes one attribute, `event.name`; `OtelLogger` lifts it onto the record's
OTel `eventName` field (the standard home, serialised by the 0.222 exporter)
and keeps the attribute as a mirror, because PostHog Logs documents attribute
filters but not `EventName`. Alerts filter on the attribute. When PostHog
surfaces `EventName`, the mirror goes.

## Testing

- `logger.test.ts`: fake OTel logger + captured stdout; severity, bound attrs
  merge, baggage attrs, `exception.*` shape, level filter.
- `span-processor.test.ts`: in-memory `BasicTracerProvider`; baggage copied,
  `posthog.distinct_id` set, image `data` replaced with the correct stub,
  non-`ai.*` spans untouched.
- `trace-carrier.test.ts`: capture → restore round-trips trace id and baggage.
- `inngest-middleware.test.ts`: fake handler; parent trace continued, link
  present, event object untouched, baggage set; missing `_trace` → new root +
  `warn`.
- Service/controller tests: `console.error` spies → fake `logger` recording
  calls. `outbox.service.test.ts` asserts `_trace` on the minted event.
- `trpc.ts`: existing router tests pass; one test asserts no delay when
  `isDev` is false.
- A fetch test asserts no `baggage` header leaves the app.
- `otel.ts`, `flush.ts`, `posthog.ts`: boot code, no unit tests.

## Risks and spikes

1. **Custom processor flush under `@vercel/otel` `waitUntil`** is undocumented.
   Mitigated by `after(flushTelemetry)`. Spike: one preview deploy, one
   receipt, all three sinks populate.
2. **AI SDK v5 `ai.*` spans convert cleanly** on the OTel path. PostHog
   documents v7 only. Same spike. Fallback: `withTracing` for v5, deleted at v7.
3. **Bedrock inference-profile cost match.** Fallback price attrs.
4. **`"auto"` semantics in `spanProcessors`.** Re-check on the installed
   version.
5. **Next 16 bundling** of OTel packages. Check whether
   `serverExternalPackages` is needed.
6. **Baggage leakage** to Bedrock or Resend. Keep outbound propagation off;
   test above.
7. **Long traces.** Retries and sweep re-delivery join the producer trace.
   Acceptable now. Switch signals for per-run traces: first fan-in job, traces
   over a few hours, differential sampling. The link already exists, so the
   switch is "stop passing the parent".
8. **PostHog and OTLP `event_name`.** Undocumented whether PostHog drops it,
   folds it into attributes, or surfaces it. Same preview spike: check whether
   `eventName` appears as a filterable field. If it does, delete the
   `event.name` attribute mirror and repoint the two alerts.

## AI SDK v7 upgrade path

The dep bump landed early (2026-09-16): `ai` 5.0.252 → 7.0.101,
`@ai-sdk/amazon-bedrock` 3.0.129 → 5.0.82. Every symbol the receipts tier uses
(`generateObject`, `APICallError`, `LanguageModel`, `TextPart`/`FilePart`)
survives — zero source change was needed. `generateObject` is deprecated since
v6 but still exported and still returns `{ object }`; the `generateText` +
`Output.object` migration is out of scope for the bump. `experimental_telemetry`
→ `telemetry` (Phase 8; the alias still compiles).

OTel wiring (Phase 3): add `@ai-sdk/otel` (peer `@opentelemetry/api` 1.9.1 — bump
the exact 1.9.0 pin) and `registerTelemetry(new LegacyOpenTelemetry())`, **not**
the SDK-recommended `new OpenTelemetry({ enrichSpan })`. `LegacyOpenTelemetry`
keeps the `ai.*` span names + `ai.prompt.messages` attribute the `ContextSpanProcessor`
redaction keys on; `OpenTelemetry` emits `gen_ai.*` semconv, which would silently
no-op redaction and ship raw receipt bytes. Moving to `gen_ai.*` + `enrichSpan`
(and moving `posthog.distinct_id` / `$groups` / `$ai_session_id` from the
processor into `enrichSpan`) is a deliberate follow-up that must re-key redaction
in the same change. Image redaction stays in the processor. Transport, logs,
error tracking, baggage, outbox carrier: unchanged.

## Out of scope

Product analytics, feature flags, session replay, evaluations, Household
groups, DB spans, Inngest `extendedTracesMiddleware`, Slack destination.

## Evidence

- `node_modules/ai` 5.0.252 `dist/index.d.ts` (`TelemetrySettings`,
  `experimental_telemetry`), `dist/index.mjs` (`stringifyForTelemetry`
  base64 inlining, `"ai.prompt.messages"`).
- `node_modules/@ai-sdk/amazon-bedrock/package.json` 3.0.129 → `aws4fetch`.
- `pnpm view @vercel/otel` dist-tags (`latest 2.1.3`, `otel-sdk-1 1.14.2`),
  peers for 1.14.2 (SDK v1) and 2.1.3 (SDK v2).
- `pnpm view @posthog/ai@8.11.1` peers; `pnpm view @ai-sdk/otel` (1.0.100, deps
  `ai 7.0.100`); current OTel line 0.222.0 / 2.11.0; `posthog-node` 5.52.2.
- vercel/otel `packages/otel/src/types.ts` (`Configuration`), `CHANGELOG.md`
  (2.0 breaking changes), `_autodocs/03-sdk.md` (`"auto"` semantics, OTLP env
  vars), `_autodocs/12-vercel-integration.md` (`waitUntil` flush).
- PostHog/posthog-js `packages/ai/src/otel/processor.ts`, `spans.ts`
  (`isAISpan` prefixes), `src/vercel/middleware.ts` (`withTracing` options),
  `src/index.ts` (`captureAiGeneration`), `packages/ai/package.json`.
- posthog.com/docs/ai-observability/installation/aws-bedrock (AWS SDK
  instrumentation path), `/installation/vercel-ai` (v7 OTel, `enrichSpan`
  attrs, `withTracing` v5/v6 only), `/installation/opentelemetry` and
  `/large-events#sending-over-opentelemetry` (4 MB / 8 MB), `/installation/
  smolagents` (attribute forwarding), `/calculating-costs` and `/generations`
  (price override props), `/privacy-mode`.
- posthog.com/docs/logs/alerts (threshold alerts, 5 min, N-of-M; "Filter by
  log attributes, resource attributes, or other log properties");
  posthog.com/docs/logs (facets: `service.name`, severity, attributes; no
  `EventName`).
- opentelemetry.io/docs/specs/otel/logs/data-model (`EventName`, stable);
  semconv attributes-registry/event (`event.name` deprecated);
  opentelemetry-proto `logs/v1/logs.proto` (`event_name = 12`, since v1.5.0);
  opentelemetry-js `experimental/CHANGELOG.md` 0.202.0 ("add eventName to
  emit #5707"); `otlp-transformer/src/logs/internal.ts` at
  `experimental/v0.222.0` (`eventName: log.eventName`).
- PostHog/posthog#52442 (`ai.telemetry.metadata.*` dropped), #61811.
- `node_modules/inngest` `components/execution/otel/*`, `engine.js`
  (`inngest.execution`), `helpers/consts.js`, `components/middleware/middleware.d.ts`.
- `node_modules/next/dist/docs/01-app/02-guides/open-telemetry.md`,
  `03-api-reference/03-file-conventions/instrumentation.md`,
  `04-functions/after.md`.
- Repo: `src/server/inngest/events.ts`, `src/server/outbox/outbox.schema.ts`,
  `src/server/receipts/receipts.controller.ts`, `receipts.service.ts`,
  `src/server/api/trpc.ts`, `src/server/inngest/client.ts`,
  `.claude/rules/bedrock-invocation.md`, `infrastructure/vercel.tf`,
  `src/env.js`.

## Related ADRs

- [adr015](../../docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md)
  — PostHog over OpenTelemetry via `@vercel/otel`; tiers depend on an injected
  `Logger` port and the ambient OTel API
- [adr016](../../docs/adr/adr016-trace-context-in-outbox-payload.md) — trace
  context in `data._trace`; the Inngest run continues the producer trace and
  links to it; the event is never rewritten
