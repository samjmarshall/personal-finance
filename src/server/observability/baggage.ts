import { type Context, context, propagation } from "@opentelemetry/api";

export const BAGGAGE_KEYS = {
	memberId: "member.id",
	receiptId: "receipt.id",
	outboxEventId: "outbox.event_id",
	inngestRunId: "inngest.run_id",
	inngestAttempt: "inngest.attempt",
} as const;

type BaggageKey = (typeof BAGGAGE_KEYS)[keyof typeof BAGGAGE_KEYS];

/**
 * Merges `attrs` into the active (or supplied) baggage context and returns a
 * new Context for use with `context.with`. Prior keys are preserved; keys in
 * `attrs` win on conflict.
 */
export function setBaggage(
	attrs: Partial<Record<BaggageKey, string>>,
	ctx = context.active(),
): Context {
	const existing = propagation.getBaggage(ctx);
	const entries: Record<string, { value: string }> = {};

	if (existing) {
		for (const [key, entry] of existing.getAllEntries()) {
			entries[key] = { value: entry.value };
		}
	}

	for (const [key, value] of Object.entries(attrs)) {
		if (value !== undefined) {
			entries[key] = { value: value as string };
		}
	}

	return propagation.setBaggage(ctx, propagation.createBaggage(entries));
}

/**
 * Reads only our known baggage keys from the active (or supplied) context.
 * Unknown keys written by upstream services are ignored.
 */
export function readBaggage(ctx = context.active()): Record<string, string> {
	const bag = propagation.getBaggage(ctx);
	if (!bag) return {};

	const result: Record<string, string> = {};
	const ourKeys = new Set<string>(Object.values(BAGGAGE_KEYS));

	for (const [key, entry] of bag.getAllEntries()) {
		if (ourKeys.has(key)) {
			result[key] = entry.value;
		}
	}

	return result;
}
