import { serve } from "inngest/next";

import { inngest } from "~/server/inngest/client";
import { functions } from "~/server/inngest/functions";
import { withFlush } from "~/server/observability/flush";

// Public webhook Inngest polls to discover + invoke the cron workers. `serve` verifies
// every request against INNGEST_SIGNING_KEY in prod (the local Dev Server needs no
// keys). Node is the App-Router default, so no `runtime` export; the sweep can scan
// many rows, so lift the Vercel function ceiling.
export const maxDuration = 300;

const handlers = serve({ client: inngest, functions });

export const GET = withFlush(handlers.GET);
export const POST = withFlush(handlers.POST);
export const PUT = withFlush(handlers.PUT);
