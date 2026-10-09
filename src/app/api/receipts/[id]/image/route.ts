import { BetterAuthSessionReader } from "~/server/auth/session-reader";
import { createRootLogger } from "~/server/observability/logging/logger";
import { ReceiptsHttpController } from "~/server/receipts/receipts.http.controller";
import { receiptsService } from "~/server/receipts/receipts.module";

// Composition root for the receipt image proxy. The controller is built on first
// request, like the other route roots; the shared service comes from its module.
let controller: ReceiptsHttpController | null = null;

function compose(): ReceiptsHttpController {
	controller ??= new ReceiptsHttpController({
		service: receiptsService,
		sessions: new BetterAuthSessionReader(),
		logger: createRootLogger().with({
			domain: "receipts",
			component: "image-route",
		}),
	});
	return controller;
}

export async function GET(
	request: Request,
	ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
	return compose().image(request, (await ctx.params).id);
}
