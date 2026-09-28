import type { Instrumentation } from "next";
import type { Logger } from "./server/observability/logging/logger";

// Cached across errors: an error storm shouldn't rebuild the logger (which
// re-reads env) each time. Runtime env is fixed, so one build is enough.
let nextLogger: Logger | undefined;

export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerObservability } = await import(
			"./server/observability/sdk/otel"
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

	const [{ reportError }, { flushTelemetry }, { createRootLogger }] =
		await Promise.all([
			import("./server/observability/errors/report-error"),
			import("./server/observability/sdk/flush"),
			import("./server/observability/logging/logger"),
		]);

	const attrs = {
		path: request.path,
		method: request.method,
		routerKind: ctx.routerKind,
		routeType: ctx.routeType,
	};
	nextLogger ??= createRootLogger().with({ domain: "next" });
	reportError(nextLogger, "unhandled route error", error, attrs);
	await flushTelemetry();
};
