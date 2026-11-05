import type { FailureEventArgs, Inngest, InngestFunction } from "inngest";
import type { DuplicateApplyService } from "./duplicate-apply.service";

const RETRIES = 3;
// adr032: one Apply at a time, so two never race on the same review.
const APPLY_SLOT = {
	limit: 1,
	key: '"duplicate-apply"',
	scope: "env",
} as const;

interface TransactionsInngestControllerDeps {
	inngest: Pick<Inngest, "createFunction">;
	service: DuplicateApplyService;
}

/**
 * Presentation tier: declares the background Apply of a Member's Answers. The
 * function id, trigger and concurrency key are FROZEN (`registry-golden.test.ts`).
 */
export class TransactionsInngestController {
	private readonly service: DuplicateApplyService;

	/** One step per batch, so a retry redoes one batch, not the Apply. */
	readonly apply: InngestFunction.Any;

	constructor({ inngest, service }: TransactionsInngestControllerDeps) {
		this.service = service;
		this.apply = inngest.createFunction(
			{
				id: "duplicate-apply",
				retries: RETRIES,
				concurrency: APPLY_SLOT,
				triggers: [{ event: "duplicate/apply.requested" }],
				onFailure: ({ event, error }: FailureEventArgs) =>
					this.service.fail(event.data.event.data.applyId, error.message),
			},
			async ({ event, step }) => {
				const applyId: number = event.data.applyId;
				let more = true;

				for (let batch = 0; more; batch += 1) {
					({ more } = await step.run(`batch-${batch}`, () =>
						this.service.applyBatch(applyId),
					));
				}

				await step.run("finish", () => this.service.finish(applyId));
			},
		);
	}

	/** Everything this controller registers with `serve`. */
	get functions(): InngestFunction.Any[] {
		return [this.apply];
	}
}
