import { describe, expect, it } from "vitest";
import { CdrInngestController } from "~/server/cdr/cdr.inngest.controller";
import { OutboxInngestController } from "~/server/outbox/outbox.inngest.controller";
import { ReceiptsInngestController } from "~/server/receipts/receipts.inngest.controller";
import pkg from "../../../package.json" with { type: "json" };

import { EVENT_REGISTRY } from "./events";

// Tripwire for the FROZEN wire strings (adr002 clause 7; server-architecture rule).
// These keys are Inngest event names — byte-stable across the wire. A change here
// must be deliberate + recorded in an ADR consequence note, never a drive-by.
describe("event registry golden", () => {
	it("pins the frozen event names", () => {
		expect(Object.keys(EVENT_REGISTRY).sort()).toEqual([
			"cdr/import.requested",
			"receipt/email.received",
			"receipt/retry",
			"receipt/uploaded",
		]);
	});
});

// Function ids, triggers and concurrency keys are also frozen: Inngest keys scheduled
// runs by id (a rename silently drops the old schedule), event triggers are the same
// wire strings as the registry above, and a renamed key splits a shared slot.
// `cdr-import`'s onFailure registers as `cdr-import-failure`, derived from its id. Drive the controllers with a spy client to read what they declare
// — avoids importing the real db/client (env-free, like the block above).
describe("worker golden", () => {
	it("pins the frozen function ids, triggers and concurrency keys", () => {
		type Opts = { id: string; triggers: unknown[]; concurrency?: unknown };
		const declared: Opts[] = [];
		const spy = {
			send: async () => {},
			createFunction: ({ id, triggers, concurrency }: Opts) => {
				declared.push({ id, triggers, concurrency });
				return { id: () => id };
			},
			// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		} as any;

		new OutboxInngestController({ inngest: spy, service: {} as never });
		new ReceiptsInngestController({ inngest: spy, service: {} as never });
		new CdrInngestController({ inngest: spy, service: {} as never });

		expect(declared).toEqual([
			{ id: "outbox-sweep", triggers: [{ cron: "0 * * * *" }] },
			{ id: "outbox-prune", triggers: [{ cron: "0 3 * * *" }] },
			{
				id: "process-receipt",
				concurrency: { key: "event.data.receiptId", limit: 1 },
				triggers: [
					{ event: "receipt/uploaded" },
					{ event: "receipt/retry" },
					{ event: "receipt/email.received" },
				],
			},
			{
				id: "cdr-sync",
				concurrency: { limit: 1, key: '"cdr-sync"', scope: "env" },
				triggers: [{ cron: "0 18 * * *" }],
			},
			{
				id: "cdr-import",
				concurrency: { limit: 1, key: '"cdr-sync"', scope: "env" },
				triggers: [{ event: "cdr/import.requested" }],
			},
		]);
	});
});

// The Inngest app id is the package name. Inngest keys the app and its schedules
// by it, so a package rename would orphan every cron.
describe("app id golden", () => {
	it("pins the package name the Inngest client uses as its app id", () => {
		expect(pkg.name).toBe("personal-finance");
	});
});
