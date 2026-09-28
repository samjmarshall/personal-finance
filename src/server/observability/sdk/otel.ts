import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import {
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
	AlwaysOnSampler,
	BatchSpanProcessor,
	ParentBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { registerTelemetry } from "ai";
import { env } from "~/env";
import { AiOutputProcessor } from "./ai-output-processor";
import {
	getRegisteredProcessors,
	setRegisteredProcessors,
} from "./otel-registry";
import { INNGEST_EXECUTION_SPAN, NameDropSampler } from "./sampler";
import { SpanAttributeProcessor } from "./span-processor";

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
		serviceName: env.PROJECT_NAME,
		propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
		// Records every root and honours a sampled parent — the outbox-continued
		// traces need the async side to keep recording (Decision 14). The name-drop
		// in front keeps Inngest's own `inngest.execution` root out (adr016 §6).
		traceSampler: new NameDropSampler({
			inner: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
			dropName: INNGEST_EXECUTION_SPAN,
		}),
		spanProcessors: [
			"auto",
			new SpanAttributeProcessor({
				inputTokenPriceUsd: env.BEDROCK_INPUT_TOKEN_PRICE_USD,
				outputTokenPriceUsd: env.BEDROCK_OUTPUT_TOKEN_PRICE_USD,
			}),
			new AiOutputProcessor({ inner: posthogSpanProcessor }),
			traceBatch,
		],
		logRecordProcessors: [logBatch],
		// Empty: trace headers reach only our own host, never Bedrock or Resend (adr015 §6).
		// Inngest's send URL holds the event key, so skip tracing that path on any host.
		instrumentationConfig: {
			fetch: {
				propagateContextUrls: [],
				ignoreUrls: [/^https?:\/\/[^/]+\/e\//],
			},
		},
	});

	// Legacy AI adapter keeps the ai.* shapes redaction + PostHog read. Register
	// after redaction, before any model call — else raw receipt bytes ship.
	registerTelemetry(new LegacyOpenTelemetry());

	setRegisteredProcessors({ traceBatch, posthogSpanProcessor, logBatch });
}
