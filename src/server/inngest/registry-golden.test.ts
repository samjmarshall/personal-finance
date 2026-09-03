import { describe, expect, it } from "vitest";

import {
	makePruneWorker,
	makeSweepWorker,
} from "~/server/outbox/outbox.workers";

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

// Function ids + crons are also frozen: Inngest keys scheduled runs by id, so a rename
// silently drops the old schedule. Drive the worker factories with a spy client to read
// what they declare — avoids importing the real db/client (env-free, like the block above).
describe("cron worker golden", () => {
	it("pins the frozen function ids + cron schedules", () => {
		const declared: { id: string; cron: string }[] = [];
		const spy = {
			send: async () => {},
			createFunction: (opts: { id: string; triggers: { cron: string }[] }) => {
				declared.push({ id: opts.id, cron: opts.triggers[0]?.cron ?? "" });
				return { id: () => opts.id };
			},
			// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		} as any;

		makeSweepWorker({ db: {} as never, inngest: spy });
		makePruneWorker({ db: {} as never, inngest: spy });

		expect(declared).toEqual([
			{ id: "outbox-sweep", cron: "0 * * * *" },
			{ id: "outbox-prune", cron: "0 3 * * *" },
		]);
	});
});
