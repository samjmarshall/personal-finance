import {
	context,
	ROOT_CONTEXT,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { Middleware } from "inngest";
import { BaggageKey, setBaggage } from "./baggage";
import { createRootLogger } from "./logger";
import { restoreTraceCarrier, TRACE_CARRIER_KEY } from "./trace-carrier";
import { tracer } from "./tracer";

// Module-level roots — the BaseMiddleware ctor is fixed `({ client })`; no DI
// seam exists, same exception adr004 makes for route files and onRequestError.
const logger = createRootLogger().with({
	domain: "inngest",
	component: "tracing",
});

export class TracingMiddleware extends Middleware.BaseMiddleware {
	readonly id = "tracing";

	// Stopgap: promote known domain ids from event data onto telemetry. Generic
	// infra shouldn't know "receiptId" — drop this once producers put domain ids
	// on baggage before buildOutboxEvent (like member.id). Tracked as Follow-up F2.
	private domainAttrs(
		data: Record<string, unknown> | undefined,
	): Record<string, string> {
		return data?.receiptId !== undefined
			? { [BaggageKey.ReceiptId]: String(data.receiptId) }
			: {};
	}

	async wrapFunctionHandler({
		ctx,
		fn,
		next,
	}: Middleware.WrapFunctionHandlerArgs): Promise<unknown> {
		const data = ctx.event.data as Record<string, unknown> | undefined;
		let parent = restoreTraceCarrier(data?.[TRACE_CARRIER_KEY]);

		if (parent === null) {
			// Cron/invoke runs (inngest/* events) never carry a _trace; warn only for
			// event-triggered runs, where a missing carrier is a real bug.
			if (!ctx.event.name.startsWith("inngest/")) {
				logger.warn("trace carrier missing", {
					"event.name": "trace.carrier.missing",
					"inngest.function_id": fn.id(),
					[BaggageKey.InngestRunId]: ctx.runId,
				});
			}
			parent = ROOT_CONTEXT;
		}

		const parentSpanCtx = trace.getSpanContext(parent);

		// Add baggage before the span starts — the span copies it once at start, so
		// anything added later is lost. Skip member.id; the parent already carries it.
		const enriched = setBaggage(
			{
				[BaggageKey.InngestRunId]: ctx.runId,
				[BaggageKey.InngestAttempt]: String(ctx.attempt),
				[BaggageKey.OutboxEventId]: ctx.event.id,
				...this.domainAttrs(data),
			},
			parent,
		);

		const span = tracer.startSpan(
			`inngest.function.${fn.id()}`,
			{
				links: parentSpanCtx ? [{ context: parentSpanCtx }] : [],
				attributes: {
					[BaggageKey.InngestRunId]: ctx.runId,
					[BaggageKey.InngestAttempt]: String(ctx.attempt),
					"inngest.function_id": fn.id(),
					"inngest.event_name": ctx.event.name,
				},
			},
			enriched,
		);

		const runCtx = trace.setSpan(enriched, span);

		try {
			return await context.with(runCtx, () => next());
		} catch (err) {
			span.recordException(err as Error);
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw err;
		} finally {
			span.end();
		}
	}

	async onRunError({
		ctx,
		error,
		fn,
		isFinalAttempt,
	}: Middleware.OnRunErrorArgs): Promise<void> {
		const data = ctx.event.data as Record<string, unknown> | undefined;
		// Inngest fires error hooks after the run's trace window closes — no active
		// trace here. Re-attach the stored carrier so this error links to its trace.
		const restored =
			restoreTraceCarrier(data?.[TRACE_CARRIER_KEY]) ?? ROOT_CONTEXT;

		const attrs: Record<string, unknown> = {
			"inngest.function_id": fn.id(),
			[BaggageKey.InngestRunId]: ctx.runId,
			[BaggageKey.InngestAttempt]: String(ctx.attempt),
			isFinalAttempt,
		};

		Object.assign(attrs, this.domainAttrs(data));

		// Dynamic import keeps the heavy analytics library out of every module that
		// just sends events — only needed on the worker execution path.
		const { captureException } = await import("./posthog");
		context.with(restored, () => {
			captureException(error, attrs);
			logger.error("inngest run failed", { error, ...attrs });
		});
	}
}
