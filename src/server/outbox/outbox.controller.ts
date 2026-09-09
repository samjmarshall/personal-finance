import type { Inngest, InngestFunction } from "inngest";

import type { OutboxService } from "./outbox.service";

interface OutboxControllerDeps {
	inngest: Pick<Inngest, "createFunction">;
	service: OutboxService;
}

/**
 * Presentation tier: declares the outbox cron functions and routes each run to the
 * service. Function ids + crons are FROZEN (`registry-golden.test.ts`) — Inngest keys
 * schedules by id, so a rename silently drops the old schedule.
 */
export class OutboxController {
	private readonly service: OutboxService;

	/** Hourly re-delivery of unacked rows (adr002 clause 4). */
	readonly sweep: InngestFunction.Any;
	/** Daily retention prune of acked rows. */
	readonly prune: InngestFunction.Any;

	constructor({ inngest, service }: OutboxControllerDeps) {
		this.service = service;
		this.sweep = inngest.createFunction(
			{ id: "outbox-sweep", triggers: [{ cron: "0 * * * *" }] },
			() => this.service.sweep(),
		);
		this.prune = inngest.createFunction(
			{ id: "outbox-prune", triggers: [{ cron: "0 3 * * *" }] },
			() => this.service.prune(),
		);
	}

	/** Everything this controller registers with `serve`. */
	get functions(): InngestFunction.Any[] {
		return [this.sweep, this.prune];
	}
}
