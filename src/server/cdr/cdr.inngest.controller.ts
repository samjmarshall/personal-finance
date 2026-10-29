import {
	type FailureEventArgs,
	type Inngest,
	type InngestFunction,
	NonRetriableError,
	RetryAfterError,
} from "inngest";

import { CdrSyncError } from "./cdr.errors";
import type { CdrSyncService } from "./cdr-sync.service";

const RETRIES = 3;
// Past this, retrying only draws another 429 or parks the run for days; the next
// daily cron, or the member's re-run, is the retry.
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
// One shared slot: a sync and an import interleave step by step but never reconcile at once.
const ONE_BANK_FETCH = { limit: 1, key: '"cdr-sync"', scope: "env" } as const;
// The run's own error is for us (Inngest keeps it); the member gets plain words.
const IMPORT_FAILED = "The import stopped on an error. Try again later.";

interface CdrInngestControllerDeps {
	inngest: Pick<Inngest, "createFunction">;
	service: CdrSyncService;
}

/**
 * Presentation tier: declares the daily bank sync and the member-run history
 * import. Function ids, triggers and the concurrency key are FROZEN
 * (`registry-golden.test.ts`).
 */
export class CdrInngestController {
	private readonly service: CdrSyncService;

	/** Daily poll; 18:00 UTC is about 4–5 am Sydney. */
	readonly sync: InngestFunction.Any;
	/** One step per account chunk, so a retry redoes one chunk, not the import. */
	readonly import: InngestFunction.Any;

	constructor({ inngest, service }: CdrInngestControllerDeps) {
		this.service = service;
		this.sync = inngest.createFunction(
			{
				id: "cdr-sync",
				retries: RETRIES,
				concurrency: ONE_BANK_FETCH,
				triggers: [{ cron: "0 18 * * *" }],
			},
			() => this.translated(() => this.service.run()),
		);
		this.import = inngest.createFunction(
			{
				id: "cdr-import",
				retries: RETRIES,
				concurrency: ONE_BANK_FETCH,
				triggers: [{ event: "cdr/import.requested" }],
				onFailure: ({ event }: FailureEventArgs) =>
					this.service.failImport(
						event.data.event.data.importId,
						IMPORT_FAILED,
					),
			},
			async ({ event, step }) => {
				const importId: number = event.data.importId;
				// Own step, so a plan retry doesn't claim again, find the import running, and quit with it stuck.
				const range = await step.run("claim", () =>
					this.translated(() => this.service.claimImport(importId)),
				);
				if (!range) return;
				const plan = await step.run("plan", () =>
					this.translated(() => this.service.planImport(importId, range)),
				);
				for (const chunk of plan.chunks)
					await step.run(`chunk-${chunk.accountId}-${chunk.from}`, () =>
						this.translated(() =>
							this.service.importChunk(importId, chunk, plan.liveAccountIds),
						),
					);
				await step.run("finish", () =>
					this.translated(() => this.service.finishImport(importId)),
				);
			},
		);
	}

	/** Everything this controller registers with `serve`. */
	get functions(): InngestFunction.Any[] {
		return [this.sync, this.import];
	}

	// Service errors know nothing about the job runner; translate them to its retry rules here.
	private async translated<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			throw toInngestError(error);
		}
	}
}

function toInngestError(error: unknown): unknown {
	if (!(error instanceof CdrSyncError)) return error;
	if (!error.retryable)
		return new NonRetriableError(error.message, { cause: error });
	if (error.retryAfterMs === null) return error;
	if (error.retryAfterMs > MAX_RETRY_AFTER_MS)
		return new NonRetriableError(error.message, { cause: error });
	return new RetryAfterError(error.message, error.retryAfterMs, {
		cause: error,
	});
}
