import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import {
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { registerTelemetry } from "ai";
import { env } from "~/env";
import {
	getRegisteredProcessors,
	setRegisteredProcessors,
} from "./otel-registry";
import { ContextSpanProcessor } from "./span-processor";

/**
 * Boots OTel + PostHog once per server instance. A no-op without POSTHOG_KEY,
 * so `make test` and a keyless local run register nothing (adr015 §1, §2).
 */
export function registerObservability(): void {
	const key = env.POSTHOG_KEY;
	if (!key) return;
	if (getRegisteredProcessors()) return;

	const host = env.POSTHOG_HOST;
	const headers = { Authorization: `Bearer ${key}` };
	const batchOpts = { scheduledDelayMillis: 1000, exportTimeoutMillis: 5000 };

	const traceBatch = new BatchSpanProcessor(
		new OTLPTraceExporter({ url: `${host}/i/v1/traces`, headers }),
		batchOpts,
	);
	const logBatch = new BatchLogRecordProcessor({
		exporter: new OTLPLogExporter({ url: `${host}/i/v1/logs`, headers }),
		...batchOpts,
	});
	const posthogSpanProcessor = new PostHogSpanProcessor({
		projectToken: key,
		host,
	});

	registerOTel({
		serviceName: "personal-finance",
		propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
		// Records every root and honours a sampled parent — the outbox-continued
		// traces need the async side to keep recording (Decision 14).
		traceSampler: "parentbased_always_on",
		spanProcessors: [
			"auto",
			new ContextSpanProcessor({
				inputTokenPriceUsd: env.BEDROCK_INPUT_TOKEN_PRICE_USD,
				outputTokenPriceUsd: env.BEDROCK_OUTPUT_TOKEN_PRICE_USD,
			}),
			posthogSpanProcessor,
			traceBatch,
		],
		logRecordProcessors: [logBatch],
		// propagateContextUrls only ADDS extra hosts to receive trace context;
		// @vercel/otel already propagates just to our own deployment/same-host URL.
		// Empty = no third party added, so Bedrock/Resend (third-party https) get no
		// traceparent/baggage. Self-fetches to our deployment still carry it (adr015 §6).
		instrumentationConfig: { fetch: { propagateContextUrls: [] } },
	});

	// LegacyOpenTelemetry keeps the ai.* span names + ai.prompt/ai.prompt.messages
	// attributes that ContextSpanProcessor redaction and PostHogSpanProcessor key
	// on. It must register after the redaction processor (above) and before any
	// generateObject runs, or a raw receipt image would ship. The v7-native
	// `OpenTelemetry` (gen_ai.* semconv) is a deliberate follow-up, not this phase.
	registerTelemetry(new LegacyOpenTelemetry());

	setRegisteredProcessors({ traceBatch, posthogSpanProcessor, logBatch });
}
