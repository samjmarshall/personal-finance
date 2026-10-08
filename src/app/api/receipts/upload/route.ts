import { BetterAuthSessionReader } from "~/server/auth/session-reader";
import { createRootLogger } from "~/server/observability/logging/logger";
import { withFlush } from "~/server/observability/sdk/flush";
import { ReceiptsHttpController } from "~/server/receipts/receipts.http.controller";
import { receiptsService } from "~/server/receipts/receipts.module";

// Composition root for the client-upload handshake. Built on first request so the
// build's page-data collection loads this file without constructing anything.
let controller: ReceiptsHttpController | null = null;

function compose(): ReceiptsHttpController {
	controller ??= new ReceiptsHttpController({
		service: receiptsService,
		sessions: new BetterAuthSessionReader(),
		logger: createRootLogger().with({
			domain: "receipts",
			component: "upload-route",
		}),
	});
	return controller;
}

export const POST = withFlush((request: Request) => compose().upload(request));
