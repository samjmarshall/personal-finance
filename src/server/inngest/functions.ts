import { env } from "~/env";
import { bedrock } from "~/server/aws/bedrock";
import { db } from "~/server/db";
import {
	makePruneWorker,
	makeSweepWorker,
} from "~/server/outbox/outbox.workers";
import { makeProcessReceiptWorker } from "~/server/receipts/receipts.workers";

import { inngest } from "./client";

// Composition root: every worker built once with the real db + client. The route
// handler (src/app/api/inngest/route.ts) serves this array; Inngest discovers each
// function's cron/event triggers from it.
export const sweepWorker = makeSweepWorker({ db, inngest });
export const pruneWorker = makePruneWorker({ db, inngest });
export const processReceiptWorker = makeProcessReceiptWorker({
	db,
	inngest,
	model: bedrock(env.BEDROCK_RECEIPT_MODEL),
});

export const functions = [sweepWorker, pruneWorker, processReceiptWorker];
