import { balanceSetDto } from "~/domain/balances";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const balanceRouter = createTRPCRouter({
	latest: protectedProcedure.query(({ ctx }) => ctx.services.balances.latest()),

	set: protectedProcedure
		.input(balanceSetDto)
		.mutation(({ ctx, input }) => ctx.services.balances.set(input)),
});
