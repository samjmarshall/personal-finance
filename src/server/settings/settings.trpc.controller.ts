import { fortnightAnchorSetDto } from "~/domain/settings";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const settingRouter = createTRPCRouter({
	fortnightAnchor: protectedProcedure.query(({ ctx }) =>
		ctx.services.settings.fortnightAnchor(),
	),

	setFortnightAnchor: protectedProcedure
		.input(fortnightAnchorSetDto)
		.mutation(({ ctx, input }) =>
			ctx.services.settings.setFortnightAnchor(input.anchor),
		),
});
