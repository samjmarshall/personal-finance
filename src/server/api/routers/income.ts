import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Income, incomeCreateDto, incomeUpdateDto } from "~/domain/income";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { income } from "~/server/income/income.schema";

export const incomeRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }): Promise<Income[]> => {
		return ctx.db
			.select()
			.from(income)
			.orderBy(asc(income.person), asc(income.sortOrder), asc(income.source));
	}),

	create: protectedProcedure
		.input(incomeCreateDto)
		.mutation(async ({ ctx, input }): Promise<Income> => {
			const [row] = await ctx.db.insert(income).values(input).returning();

			if (!row) {
				console.error("Failed to create income.", { input });
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create income.",
				});
			}

			return row;
		}),

	update: protectedProcedure
		.input(incomeUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Income> => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(income)
				.set(values)
				.where(eq(income.id, id))
				.returning();

			if (!row) {
				console.error("Failed to update income.", { id, values });
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update income.",
				});
			}

			return row;
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(income).where(eq(income.id, input.id));
			return { success: true };
		}),
});
