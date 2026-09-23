import { serve } from "inngest/next";
import { after, type NextRequest } from "next/server";

import { inngest } from "~/server/inngest/client";
import { functions } from "~/server/inngest/functions";
import { flushTelemetry } from "~/server/observability/flush";

// Public webhook Inngest polls to discover + invoke the cron workers. `serve` verifies
// every request against INNGEST_SIGNING_KEY in prod (the local Dev Server needs no
// keys). Node is the App-Router default, so no `runtime` export; the sweep can scan
// many rows, so lift the Vercel function ceiling.
export const maxDuration = 300;

const handlers = serve({ client: inngest, functions });

// Drain telemetry after each response, before the lambda freezes (adr015 §8) — a
// worker run's spans/logs would otherwise be lost when the invocation is frozen.
// Direct-call helper (not a closure factory): each verb export delegates here.
function flushThen(
	handler: (req: NextRequest, ctx: unknown) => Promise<Response>,
	req: NextRequest,
	ctx: unknown,
): Promise<Response> {
	after(flushTelemetry);
	return handler(req, ctx);
}

export const GET = (req: NextRequest, ctx: unknown) =>
	flushThen(handlers.GET, req, ctx);
export const POST = (req: NextRequest, ctx: unknown) =>
	flushThen(handlers.POST, req, ctx);
export const PUT = (req: NextRequest, ctx: unknown) =>
	flushThen(handlers.PUT, req, ctx);
