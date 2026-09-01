import { desc } from "drizzle-orm";
import { type BalanceSnapshot, balanceSetDto } from "~/domain/balances";
import { assertRow } from "~/server/api/lib/assert-row";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { balanceSnapshots } from "~/server/balances/balances.schema";

export const balanceRouter = createTRPCRouter({
	// Newest snapshot anchors the projection; tiebreak id desc for same-asOf rows.
	latest: protectedProcedure.query(
		async ({ ctx }): Promise<BalanceSnapshot | null> => {
			const [row] = await ctx.db
				.select()
				.from(balanceSnapshots)
				.orderBy(desc(balanceSnapshots.asOf), desc(balanceSnapshots.id))
				.limit(1);
			return row ?? null;
		},
	),

	// Records a new snapshot — history is kept, latest wins. Never an in-place edit.
	set: protectedProcedure
		.input(balanceSetDto)
		.mutation(async ({ ctx, input }): Promise<BalanceSnapshot> => {
			const [row] = await ctx.db
				.insert(balanceSnapshots)
				.values(input)
				.returning();
			return assertRow(row, "set balance");
		}),
});
