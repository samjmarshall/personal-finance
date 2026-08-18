import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
	type Expense,
	expenseCreateDto,
	expenseUpdateDto,
} from "~/domain/expenses";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenses } from "~/server/expenses/expenses.schema";

export const expenseRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }): Promise<Expense[]> => {
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
		.input(expenseCreateDto)
		.mutation(async ({ ctx, input }): Promise<Expense> => {
			const [row] = await ctx.db.insert(expenses).values(input).returning();

			if (!row) {
				console.error("Failed to create expense.", { input });
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create expense.",
				});
			}

			return row;
		}),

	update: protectedProcedure
		.input(expenseUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Expense> => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(expenses)
				.set(values)
				.where(eq(expenses.id, id))
				.returning();

			if (!row) {
				console.error("Failed to update expense.", { id, input });
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update expense.",
				});
			}

			return row;
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(expenses).where(eq(expenses.id, input.id));
			return { success: true };
		}),
});
