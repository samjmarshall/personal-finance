import type { Instrumentation } from "next";
import type { Logger } from "./server/observability/logger";

// Cached across errors: an error storm shouldn't rebuild the logger (which
// re-reads env) each time. Runtime env is fixed, so one build is enough.
let nextLogger: Logger | undefined;

export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerObservability } = await import(
			"./server/observability/otel"
		);
		registerObservability();
	}
}

// Dynamic: this file loads in edge too, and posthog-node/OTLP exporters are
// node-only — a static import crashes edge. Each sink self-bounds 5 s, so it's
// safe to await per-error (the flush-before-freeze point, adr015 §7–8).
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
	nextLogger ??= createRootLogger().with({ domain: "next" });
	nextLogger.error("unhandled route error", { error, ...attrs });
	await flushTelemetry();
};
