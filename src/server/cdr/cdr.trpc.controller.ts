import { cdrSetInBalanceDto, cdrSetNicknameDto } from "~/domain/cdr";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const cdrRouter = createTRPCRouter({
	syncState: protectedProcedure.query(({ ctx }) =>
		ctx.services.cdr.listSyncState(),
	),

	setInBalance: protectedProcedure
		.input(cdrSetInBalanceDto)
		.mutation(({ ctx, input }) => ctx.services.cdr.setInBalance(input)),

	setNickname: protectedProcedure
		.input(cdrSetNicknameDto)
		.mutation(({ ctx, input }) => ctx.services.cdr.setNickname(input)),
});
