import { serve } from "inngest/next";
import type { NextRequest } from "next/server";

import { inngest } from "~/server/inngest/client";
import { functions } from "~/server/inngest/functions";
import { flushAfterResponse } from "~/server/observability/flush";

// Public webhook Inngest polls to discover + invoke the cron workers. `serve` verifies
// every request against INNGEST_SIGNING_KEY in prod (the local Dev Server needs no
// keys). Node is the App-Router default, so no `runtime` export; the sweep can scan
// many rows, so lift the Vercel function ceiling.
export const maxDuration = 300;

const handlers = serve({ client: inngest, functions });

export function GET(req: NextRequest, ctx: unknown): Promise<Response> {
	flushAfterResponse();
	return handlers.GET(req, ctx);
}

export function POST(req: NextRequest, ctx: unknown): Promise<Response> {
	flushAfterResponse();
	return handlers.POST(req, ctx);
}

export function PUT(req: NextRequest, ctx: unknown): Promise<Response> {
	flushAfterResponse();
	return handlers.PUT(req, ctx);
}
