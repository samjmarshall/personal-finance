import { z } from "zod";
import { incomeCreateDto, incomeUpdateDto } from "~/domain/income";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const incomeRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) => ctx.services.income.list()),

	create: protectedProcedure
		.input(incomeCreateDto)
		.mutation(({ ctx, input }) => ctx.services.income.create(input)),

	update: protectedProcedure
		.input(incomeUpdateDto)
		.mutation(({ ctx, input }) => ctx.services.income.update(input)),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.services.income.delete(input.id);
			return { success: true };
		}),
});
