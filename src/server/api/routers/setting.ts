import { eq } from "drizzle-orm";
import { fortnightAnchorSetDto } from "~/domain/settings";
import { fromDateInput } from "~/lib/utils";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { FORTNIGHT_ANCHOR_KEY } from "~/server/settings/settings.constants";
import { appSettings } from "~/server/settings/settings.schema";

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

	// Upsert, not insert: the seed migration already planted the row, and a member
	// re-anchoring is the common case. Returns the string for the same wire reason
	// the query does.
	setFortnightAnchor: protectedProcedure
		.input(fortnightAnchorSetDto)
		.mutation(async ({ ctx, input }): Promise<string> => {
			const [row] = await ctx.db
				.insert(appSettings)
				.values({ key: FORTNIGHT_ANCHOR_KEY, value: input.value })
				.onConflictDoUpdate({
					target: appSettings.key,
					set: { value: input.value },
				})
				.returning();
			return assertRow(row, "set fortnight anchor").value;
		}),
});
