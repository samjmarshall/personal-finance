import { allowedSenderCreateDto, allowedSenderRefDto } from "~/domain/email";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const allowedSenderRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) =>
		ctx.services.allowedSenders.list(ctx.session.user.id),
	),

	// Members self-register the address they forward from. Ownership is server-set
	// from the session — a client-supplied userId would let anyone route someone
	// else's mail into their own name.
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
