import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenses } from "~/server/expenses/expenses.schema";

const expenseInput = z.object({
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	fortnight: z.number().nonnegative().default(0),
	month: z.number().nonnegative().default(0),
	year: z.number().nonnegative().default(0),
});

export const expenseRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select()
			.from(expenses)
			.orderBy(
				asc(expenses.category),
				asc(expenses.sortOrder),
				asc(expenses.name),
			);
	}),

	create: protectedProcedure
		.input(expenseInput)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db.insert(expenses).values(input).returning();
			return row;
		}),

	update: protectedProcedure
		.input(expenseInput.extend({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(expenses)
				.set(values)
				.where(eq(expenses.id, id))
				.returning();
			return row;
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(expenses).where(eq(expenses.id, input.id));
			return { success: true };
		}),
});
