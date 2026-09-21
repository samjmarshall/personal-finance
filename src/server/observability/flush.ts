import { getRegisteredProcessors } from "./otel-registry";
import { flushPostHog } from "./posthog";

const FLUSH_TIMEOUT_MS = 5000;

/**
 * Force-flushes every telemetry sink before a serverless freeze (adr015 §8).
 * Each sink is bounded by a 5 s timeout and settled independently, so this never
 * throws and never blocks unboundedly. A no-op when nothing is registered.
 */
export async function flushTelemetry(): Promise<void> {
	const registered = getRegisteredProcessors();
	const tasks: Promise<unknown>[] = [flushPostHog()];
	if (registered) {
		tasks.push(
			registered.traceBatch.forceFlush(),
			registered.posthogSpanProcessor.forceFlush(),
			registered.logBatch.forceFlush(),
		);
	}
	await Promise.allSettled(tasks.map(withTimeout));
}

function withTimeout(task: Promise<unknown>): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise((resolve) => {
		// unref so a slow exporter can't hold the process open past freeze.
		timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
		timer.unref();
	});
	// Clear the timer once the winner settles, so a fast flush leaves no pending
	// timer behind on a long-lived (dev / warm) process.
	return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}
