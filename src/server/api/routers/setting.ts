import { eq } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { appSettings } from "~/server/settings/settings.schema";

const FORTNIGHT_ANCHOR_KEY = "fortnightAnchor";

// Stored as YYYY-MM-DD; parse to local midnight so the fortnight grid seeds off
// the calendar date, not a UTC instant (matches src/lib/utils toDateInput).
function parseAnchor(value: string): Date | null {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return null;
	const date = new Date(year, month - 1, day);
	// Reject an out-of-range value (e.g. month 13, day 32) that Date would silently
	// roll into another month — degrade to month-only, never seed a wrong grid.
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	)
		return null;
	return date;
}

export const settingRouter = createTRPCRouter({
	// The household payday seeding fortnight period windows. null when unseeded or
	// malformed — the Unplanned picker degrades to month-only, never errors.
	fortnightAnchor: protectedProcedure.query(
		async ({ ctx }): Promise<Date | null> => {
			const [row] = await ctx.db
				.select({ value: appSettings.value })
				.from(appSettings)
				.where(eq(appSettings.key, FORTNIGHT_ANCHOR_KEY));
			return row ? parseAnchor(row.value) : null;
		},
	),
});
