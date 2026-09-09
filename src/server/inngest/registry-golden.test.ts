import { describe, expect, it } from "vitest";

import {
	makePruneWorker,
	makeSweepWorker,
} from "~/server/outbox/outbox.workers";
import { makeProcessReceiptWorker } from "~/server/receipts/receipts.workers";

import { EVENT_REGISTRY } from "./events";

// Tripwire for the FROZEN wire strings (adr002 clause 7; server-architecture rule).
// These keys are Inngest event names — byte-stable across the wire. A change here
// must be deliberate + recorded in an ADR consequence note, never a drive-by.
describe("event registry golden", () => {
	it("pins the frozen event names", () => {
		expect(Object.keys(EVENT_REGISTRY).sort()).toEqual([
			"receipt/email.received",
			"receipt/retry",
			"receipt/uploaded",
		]);
	});
});

// Function ids + triggers are also frozen: Inngest keys scheduled runs by id (a rename
// silently drops the old schedule) and event triggers are the same wire strings as the
// registry above. Drive the worker factories with a spy client to read what they declare
// — avoids importing the real db/client (env-free, like the block above).
describe("worker golden", () => {
	it("pins the frozen function ids + triggers", () => {
		const declared: { id: string; triggers: unknown[] }[] = [];
		const spy = {
			send: async () => {},
			createFunction: (opts: { id: string; triggers: unknown[] }) => {
				declared.push({ id: opts.id, triggers: opts.triggers });
				return { id: () => opts.id };
			},
			// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		} as any;

		makeSweepWorker({ db: {} as never, inngest: spy });
		makePruneWorker({ db: {} as never, inngest: spy });
		makeProcessReceiptWorker({
			db: {} as never,
			inngest: spy,
			model: {} as never,
		});

		expect(declared).toEqual([
			{ id: "outbox-sweep", triggers: [{ cron: "0 * * * *" }] },
			{ id: "outbox-prune", triggers: [{ cron: "0 3 * * *" }] },
			{
				id: "process-receipt",
				triggers: [
					{ event: "receipt/uploaded" },
					{ event: "receipt/retry" },
					{ event: "receipt/email.received" },
				],
			},
		]);
	});
});
