import { cashflowQueryDto } from "~/domain/cashflow";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const cashflowRouter = createTRPCRouter({
	get: protectedProcedure
		.input(cashflowQueryDto)
		.query(({ ctx, input }) => ctx.services.cashflow.get(input.periodKind)),
});
