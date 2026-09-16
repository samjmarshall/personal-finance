import type { Instrumentation } from "next";

export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerObservability } = await import(
			"./server/observability/otel"
		);
		registerObservability();
	}
}

// Deps are dynamic-imported under the nodejs guard, never static: this file loads
// in the edge runtime too, and posthog-node / the OTLP exporters are node-only —
// a top-level import would drag them into the edge bundle and defeat register()'s
// deferral. captureException + flushTelemetry are no-ops without POSTHOG_KEY, and
// flushTelemetry self-bounds each sink to 5 s, so awaiting it per error is the
// serverless flush-before-freeze choke point (adr015 §7, §8), not an open block.
export const onRequestError: Instrumentation.onRequestError = async (
	error,
	request,
	ctx,
) => {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	const [{ captureException }, { flushTelemetry }, { createRootLogger }] =
		await Promise.all([
			import("./server/observability/posthog"),
			import("./server/observability/flush"),
			import("./server/observability/logger"),
		]);

	const attrs = {
		path: request.path,
		method: request.method,
		routerKind: ctx.routerKind,
		routeType: ctx.routeType,
	};
	captureException(error, attrs);
	createRootLogger()
		.with({ domain: "next" })
		.error("unhandled route error", { error, ...attrs });
	await flushTelemetry();
};
