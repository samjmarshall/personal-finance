import { z } from "zod";
import {
	categoryCreateDto,
	categoryReorderDto,
	categoryUpdateDto,
} from "~/domain/categories";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const categoryRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) => ctx.services.categories.list()),

	create: protectedProcedure
		.input(categoryCreateDto)
		.mutation(({ ctx, input }) => ctx.services.categories.create(input)),

	update: protectedProcedure
		.input(categoryUpdateDto)
		.mutation(({ ctx, input }) => ctx.services.categories.update(input)),

	reorder: protectedProcedure
		.input(categoryReorderDto)
		.mutation(async ({ ctx, input }) => {
			await ctx.services.categories.reorder(input.ids);
			return { success: true };
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.services.categories.delete(input.id);
			return { success: true };
		}),
});
