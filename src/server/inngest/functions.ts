import { db } from "~/server/db";
import {
	makePruneWorker,
	makeSweepWorker,
} from "~/server/outbox/outbox.workers";

import { inngest } from "./client";

// Composition root: the two cron workers built once with the real db + client. The
// route handler (src/app/api/inngest/route.ts) serves this array; Inngest discovers
// each function's cron from it.
export const sweepWorker = makeSweepWorker({ db, inngest });
export const pruneWorker = makePruneWorker({ db, inngest });

export const functions = [sweepWorker, pruneWorker];
