import { trace } from "@opentelemetry/api";
import { PostHog } from "posthog-node";
import { env } from "~/env";
import { BAGGAGE_KEYS, readBaggage } from "./baggage";

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

	const distinctId = readBaggage()[BAGGAGE_KEYS.memberId] ?? "server";
	const spanCtx = trace.getActiveSpan()?.spanContext();

	posthog.captureException(error, distinctId, {
		...(spanCtx
			? { $trace_id: spanCtx.traceId, $span_id: spanCtx.spanId }
			: {}),
		...props,
	});
}

/** Drains queued events before a serverless freeze. No-op without a client. */
export async function flushPostHog(): Promise<void> {
	if (!client) return;
	await client.flush();
}
