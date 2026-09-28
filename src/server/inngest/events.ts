import { z } from "zod";
import {
	captureTraceCarrier,
	TRACE_CARRIER_KEY,
} from "~/server/observability/tracing/trace-carrier";

/**
 * Single naming + payload authority for outbox events (adr002 clause 7). Keys are
 * FROZEN Inngest wire strings — golden-pinned in `./registry-golden.test.ts`.
 * receiptId is the integer `receipt` PK — firmed from the stage-4 provisional
 * string once the stage-5 producer landed.
 */
export const EVENT_REGISTRY = {
	"receipt/uploaded": z.object({ receiptId: z.number().int() }),
	"receipt/email.received": z.object({ receiptId: z.number().int() }),
	"receipt/retry": z.object({ receiptId: z.number().int() }),
} as const;

export type EventName = keyof typeof EVENT_REGISTRY;
export type EventPayload<K extends EventName> = z.infer<
	(typeof EVENT_REGISTRY)[K]
>;

/** One outbox row's worth of event: `id` is both PK and Inngest idempotency key. */
export interface OutboxEventDescriptor {
	id: string;
	name: EventName;
	data: unknown;
}

export function buildOutboxEvent<K extends EventName>(
	name: K,
	payload: EventPayload<K>,
): OutboxEventDescriptor {
	// The `_trace` pocket is appended after parse so `z.object` stripping never
	// removes it (adr016 clause 1). Nothing else writes this key.
	const data = EVENT_REGISTRY[name].parse(payload);
	return {
		id: crypto.randomUUID(),
		name,
		data: { ...data, [TRACE_CARRIER_KEY]: captureTraceCarrier() },
	};
}
