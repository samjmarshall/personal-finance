import {
	type Inngest,
	type InngestFunction,
	NonRetriableError,
	RetryAfterError,
} from "inngest";

import { CdrSyncError } from "./cdr.errors";
import type { CdrSyncService } from "./cdr-sync.service";

const RETRIES = 3;
// Past this, retrying only draws another 429 or parks the run for days; the next
// daily cron is the retry.
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

interface CdrInngestControllerDeps {
	inngest: Pick<Inngest, "createFunction">;
	service: CdrSyncService;
}

/**
 * Presentation tier: declares the daily bank sync. Function id + cron are FROZEN
 * (`registry-golden.test.ts`).
 */
export class CdrInngestController {
	private readonly service: CdrSyncService;

	/** Daily poll; 18:00 UTC is about 4–5 am Sydney. */
	readonly sync: InngestFunction.Any;

	constructor({ inngest, service }: CdrInngestControllerDeps) {
		this.service = service;
		this.sync = inngest.createFunction(
			{
				id: "cdr-sync",
				retries: RETRIES,
				// Two overlapping runs would fetch the same windows twice.
				concurrency: { limit: 1 },
				triggers: [{ cron: "0 18 * * *" }],
			},
			async () => {
				try {
					await this.service.run();
				} catch (error) {
					throw toInngestError(error);
				}
			},
		);
	}

	/** Everything this controller registers with `serve`. */
	get functions(): InngestFunction.Any[] {
		return [this.sync];
	}
}

// Turns the service's plain failure into retry, wait-then-retry, or give up.
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
