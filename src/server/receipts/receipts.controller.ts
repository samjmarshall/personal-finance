import type { Inngest, InngestFunction } from "inngest";

import type { ReceiptsService } from "./receipts.service";

// Inngest retry budget for transient provider errors (529 overloaded, 429, network).
// The AI SDK already retries twice over ~6s; these back off over minutes to ride out
// a real outage. Explicit so the final-attempt check below can't drift from it.
const RETRIES = 3;

interface ReceiptsControllerDeps {
	inngest: Pick<Inngest, "createFunction">;
	service: ReceiptsService;
}

/**
 * Presentation tier: declares the receipt event functions and routes each run to the
 * service. Function id + triggers are FROZEN (`registry-golden.test.ts`).
 */
export class ReceiptsController {
	private readonly service: ReceiptsService;

	/** Extraction on upload, explicit retry, and inbound email. */
	readonly process: InngestFunction.Any;

	constructor({ inngest, service }: ReceiptsControllerDeps) {
		this.service = service;
		this.process = inngest.createFunction(
			{
				id: "process-receipt",
				retries: RETRIES,
				// One run at a time per receipt. The service's status guard only stops a
				// *later* delivery; two concurrent ones (an at-least-once redelivery racing
				// the first send, or a retry fired mid-run) would both read `pending`, both
				// pay for an extraction, and both insert the line items. Serialised, the
				// second finds `processed` and returns. Keyed on the receipt, so unrelated
				// receipts still run in parallel.
				concurrency: { key: "event.data.receiptId", limit: 1 },
				// All three carry the same `{ receiptId }` payload, so the email Channel
				// rides the upload path's extraction unchanged.
				triggers: [
					{ event: "receipt/uploaded" },
					{ event: "receipt/retry" },
					{ event: "receipt/email.received" },
				],
			},
			({ event, attempt }) =>
				this.service.process(event.data.receiptId, {
					isFinalAttempt: attempt >= RETRIES,
				}),
		);
	}

	/** Everything this controller registers with `serve`. */
	get functions(): InngestFunction.Any[] {
		return [this.process];
	}
}
