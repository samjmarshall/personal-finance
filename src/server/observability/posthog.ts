import { PostHog } from "posthog-node";
import { env } from "~/env";
import { BaggageKey, readBaggage } from "./baggage";
import { currentSpanContext } from "./current-trace-id";

// undefined = not yet built; null = no key, a permanent no-op for this process.
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
	if (client !== undefined) return client;
	client = env.POSTHOG_KEY
		? new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 1 })
		: null;
	return client;
}

/**
 * Sends an exception to PostHog Error Tracking. No-op without POSTHOG_KEY.
 * distinctId is the Member from baggage, or "server" for a request with no
 * Member on context; correlates to the trace via $trace_id/$span_id.
 */
export function captureException(
	error: unknown,
	props?: Record<string, unknown>,
): void {
	const posthog = getClient();
	if (!posthog) return;

	try {
		const distinctId = readBaggage()[BaggageKey.MemberId] ?? "server";
		const spanCtx = currentSpanContext();

		posthog.captureException(error, distinctId, {
			// Same value spans carry, so one production filter works for alerts on both.
			"deployment.environment.name": process.env.VERCEL_ENV,
			...(spanCtx
				? { $trace_id: spanCtx.traceId, $span_id: spanCtx.spanId }
				: {}),
			...props,
		});
	} catch (captureError) {
		// Error Tracking is best-effort; a telemetry failure must never break the
		// caller's path (e.g. turn a parked receipt run into a thrown one). Surface it
		// on stderr so the failure is still visible in process logs.
		console.error("posthog captureException failed", captureError);
	}
}

/** Drains queued events before a serverless freeze. No-op without a client. */
export async function flushPostHog(): Promise<void> {
	if (!client) return;
	await client.flush();
}
