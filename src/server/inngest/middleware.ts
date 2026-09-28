import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { Middleware } from "inngest";
import { createRootLogger } from "~/server/observability/logging/logger";
import { BaggageKey } from "~/server/observability/tracing/baggage";
import {
	restoreTraceCarrier,
	TRACE_CARRIER_KEY,
} from "~/server/observability/tracing/trace-carrier";
import { withSpan } from "~/server/observability/tracing/tracer";

// Module-level roots — the BaseMiddleware ctor is fixed `({ client })`; no DI
// seam exists, same exception adr004 makes for route files and onRequestError.
const logger = createRootLogger().with({
	domain: "inngest",
	component: "tracing",
});

// Inngest's own default when a function sets no `retries`.
const DEFAULT_RETRIES = 3;

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

	// A server that omits its attempt cap makes every attempt look retryable, so no
	// issue would ever be raised. Fall back to the function's own retry setting.
	private isFinal({
		ctx,
		fn,
		isFinalAttempt,
	}: Middleware.OnRunErrorArgs): boolean {
		if (isFinalAttempt || ctx.maxAttempts !== undefined) return isFinalAttempt;
		return ctx.attempt >= (fn.opts.retries ?? DEFAULT_RETRIES);
	}

	async wrapFunctionHandler({
		ctx,
		fn,
		next,
	}: Middleware.WrapFunctionHandlerArgs): Promise<unknown> {
		const data = ctx.event.data as Record<string, unknown> | undefined;
		const restored = restoreTraceCarrier(data?.[TRACE_CARRIER_KEY]);
		// Cron/invoke runs (inngest/* events) come from Inngest, not the outbox: no
		// _trace, and their event id is Inngest's own, not an outbox row id.
		const fromOutbox = !ctx.event.name.startsWith("inngest/");
		const carrierMissing = restored === null && fromOutbox;
		const parent = restored ?? ROOT_CONTEXT;

		const parentSpanCtx = trace.getSpanContext(parent);

		return withSpan(
			`inngest.function.${fn.id()}`,
			{
				links: parentSpanCtx ? [{ context: parentSpanCtx }] : [],
				attributes: {
					[BaggageKey.InngestRunId]: ctx.runId,
					[BaggageKey.InngestAttempt]: String(ctx.attempt),
					"inngest.function_id": fn.id(),
					"inngest.event_name": ctx.event.name,
				},
				parent,
				// Skip member.id; the parent already carries it.
				baggage: {
					[BaggageKey.InngestRunId]: ctx.runId,
					[BaggageKey.InngestAttempt]: String(ctx.attempt),
					[BaggageKey.OutboxEventId]: fromOutbox ? ctx.event.id : undefined,
					...this.domainAttrs(data),
				},
			},
			async () => {
				// Warn under our own span. The ambient one out here is Inngest's dropped
				// `inngest.execution`, so its trace id would point at nothing exported.
				if (carrierMissing) {
					logger.warn("trace carrier missing", {
						"event.name": "trace.carrier.missing",
						"inngest.function_id": fn.id(),
						[BaggageKey.InngestRunId]: ctx.runId,
					});
				}
				return await next();
			},
		);
	}

	async onRunError(args: Middleware.OnRunErrorArgs): Promise<void> {
		const { ctx, error, fn } = args;
		const isFinalAttempt = this.isFinal(args);
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

		// A retry may still succeed — log it, but raise an Error Tracking issue only
		// once the run has truly failed.
		if (!isFinalAttempt) {
			context.with(restored, () => {
				logger.warn("inngest attempt failed", { error, ...attrs });
			});
			return;
		}

		// Dynamic import keeps the heavy analytics library out of every module that
		// just sends events — only needed on the worker execution path.
		const { reportError } = await import(
			"~/server/observability/errors/report-error"
		);
		context.with(restored, () => {
			reportError(logger, "inngest run failed", error, attrs);
		});
	}
}
