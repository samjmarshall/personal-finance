import { serve } from "inngest/next";

import { inngest } from "~/server/inngest/client";
import { functions } from "~/server/inngest/functions";

// Public webhook Inngest polls to discover + invoke the cron workers. `serve` verifies
// every request against INNGEST_SIGNING_KEY in prod (the local Dev Server needs no
// keys). Node is the App-Router default, so no `runtime` export; the sweep can scan
// many rows, so lift the Vercel function ceiling.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
