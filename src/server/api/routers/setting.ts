import { eq } from "drizzle-orm";
import { fromDateInput } from "~/lib/utils";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { appSettings } from "~/server/settings/settings.schema";

const FORTNIGHT_ANCHOR_KEY = "fortnightAnchor";

export const settingRouter = createTRPCRouter({
	// The household payday (YYYY-MM-DD) seeding fortnight period windows. Returns the
	// raw date STRING, not a Date: a Date serialises to a UTC instant over the wire
	// and the client re-reads its calendar date in the browser tz, walking behind-UTC
	// users a day early (the drift toDateInput exists to avoid). The client parses the
	// string to local midnight with fromDateInput. null when unseeded or malformed —
	// the Unplanned picker degrades to month-only, never errors.
	fortnightAnchor: protectedProcedure.query(
		async ({ ctx }): Promise<string | null> => {
			const [row] = await ctx.db
				.select({ value: appSettings.value })
				.from(appSettings)
				.where(eq(appSettings.key, FORTNIGHT_ANCHOR_KEY));
			return row && fromDateInput(row.value) ? row.value : null;
		},
	),
});
