import { Inngest } from "inngest";

import { env } from "~/env";

// `id` is the app name (matches the Portless host).
// `eventKey` also auto-reads INNGEST_EVENT_KEY; passed explicitly so env-validation
// owns it. Signing key is read by `serve` at the route handler, not here.
//
// inngest v4 removed the client `schemas`/`EventSchemas().fromZod()` option — event
// typing moved onto per-function triggers. EVENT_REGISTRY (events.ts) stays the
// naming/payload authority; validation happens at the mint boundary (buildOutboxEvent),
// which every send goes through, so an untyped `send` here is safe.
export const inngest = new Inngest({
	id: "personal-finance",
	eventKey: env.INNGEST_EVENT_KEY,
});
