import { z } from "zod";
import {
	categoryCreateDto,
	categoryReorderDto,
	categoryUpdateDto,
} from "~/domain/categories";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const categoryRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) =>
		ctx.services.expenses.listCategories(),
	),

	create: protectedProcedure
		.input(categoryCreateDto)
		.mutation(({ ctx, input }) => ctx.services.expenses.createCategory(input)),

	update: protectedProcedure
		.input(categoryUpdateDto)
		.mutation(({ ctx, input }) => ctx.services.expenses.updateCategory(input)),

	reorder: protectedProcedure
		.input(categoryReorderDto)
		.mutation(async ({ ctx, input }) => {
			await ctx.services.expenses.reorderCategories(input.ids);
			return { success: true };
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.services.expenses.deleteCategory(input.id);
			return { success: true };
		}),
});
