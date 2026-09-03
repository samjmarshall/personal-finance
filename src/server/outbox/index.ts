import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";

import { makeCommitWithOutbox, makePublish } from "./commit";

// Wired singletons composed with the real db + inngest client. Stage-5 routers import
// these; the factories (./commit) stay exported for injected-fake unit tests.
export const commitWithOutbox = makeCommitWithOutbox({ db, inngest });
export const publish = makePublish({ db, inngest });

export { makeCommitWithOutbox, makePublish } from "./commit";
export { outbox } from "./outbox.schema";
