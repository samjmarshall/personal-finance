import {
	allowedSenderCreateDto,
	allowedSenderRefDto,
} from "~/domain/allowed-senders";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const allowedSenderRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) =>
		ctx.services.allowedSenders.list(ctx.session.user.id),
	),

	// Owner comes from the session, never the input: else a client could file an
	// address under another member.
	add: protectedProcedure
		.input(allowedSenderCreateDto)
		.mutation(({ ctx, input }) =>
			ctx.services.allowedSenders.add(ctx.session.user.id, input.email),
		),

	remove: protectedProcedure
		.input(allowedSenderRefDto)
		.mutation(async ({ ctx, input }) => {
			await ctx.services.allowedSenders.remove(ctx.session.user.id, input.id);
			return { success: true };
		}),
});
