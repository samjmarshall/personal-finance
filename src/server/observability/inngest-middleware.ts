import {
	context,
	ROOT_CONTEXT,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { Middleware } from "inngest";
import { setBaggage } from "./baggage";
import { createRootLogger } from "./logger";
import { captureException } from "./posthog";
import { restoreTraceCarrier } from "./trace-carrier";

// Module-level roots — the BaseMiddleware ctor is fixed `({ client })`; no DI
// seam exists, same exception adr004 makes for route files and onRequestError.
const logger = createRootLogger().with({
	domain: "inngest",
	component: "tracing",
});
const tracer = trace.getTracer("personal-finance");

export class TracingMiddleware extends Middleware.BaseMiddleware {
	readonly id = "tracing";

	async wrapFunctionHandler({
		ctx,
		fn,
		next,
	}: Middleware.WrapFunctionHandlerArgs): Promise<unknown> {
		const data = ctx.event.data as Record<string, unknown> | undefined;
		let parent = restoreTraceCarrier(data?._trace);

		if (parent === null) {
			logger.warn("trace carrier missing", {
				"event.name": "trace.carrier.missing",
				"inngest.function_id": fn.id(),
				"inngest.run_id": ctx.runId,
			});
			parent = ROOT_CONTEXT;
		}

		const parentSpanCtx = trace.getSpanContext(parent);
		const span = tracer.startSpan(
			`inngest.function.${fn.id()}`,
			{
				links: parentSpanCtx ? [{ context: parentSpanCtx }] : [],
				attributes: {
					"inngest.run_id": ctx.runId,
					"inngest.attempt": ctx.attempt,
					"inngest.function_id": fn.id(),
					"inngest.event_name": ctx.event.name,
				},
			},
			parent,
		);

		// don't re-pass member.id — it's already on parent's baggage (restored from
		// the _trace pocket) and setBaggage preserves prior keys (baggage.ts:22-28).
		const baggageCtx = setBaggage(
			{
				"inngest.run_id": ctx.runId,
				"inngest.attempt": String(ctx.attempt),
				"outbox.event_id": ctx.event.id,
				...(data?.receiptId !== undefined
					? { "receipt.id": String(data.receiptId) }
					: {}),
			},
			trace.setSpan(parent, span),
		);

		try {
			return await context.with(baggageCtx, () => next());
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
		const attrs: Record<string, unknown> = {
			"inngest.function_id": fn.id(),
			"inngest.run_id": ctx.runId,
			"inngest.attempt": ctx.attempt,
			isFinalAttempt,
		};

		if (data?.receiptId !== undefined) {
			attrs["receipt.id"] = String(data.receiptId);
		}

		captureException(error, attrs);
		logger.error("inngest run failed", { error, ...attrs });
	}
}
