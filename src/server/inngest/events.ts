import { z } from "zod";

/**
 * Single naming + payload authority for outbox events (adr002 clause 7). Keys are
 * FROZEN Inngest wire strings — golden-pinned in `./registry-golden.test.ts`.
 * Payload shapes are provisional: the receipt consumers land in stage 5 and may firm
 * them up. Nothing produces these events yet; stage 4 builds the rail only.
 */
export const EVENT_REGISTRY = {
	"receipt/uploaded": z.object({ receiptId: z.string() }),
	"receipt/email.received": z.object({ receiptId: z.string() }),
	"receipt/retry": z.object({ receiptId: z.string() }),
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
	return {
		id: crypto.randomUUID(),
		name,
		data: EVENT_REGISTRY[name].parse(payload),
	};
}
