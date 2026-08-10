import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { income } from "~/server/db/schema";
import { asc, eq } from "drizzle-orm";

const incomeInput = z.object({
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
	fortnight: z.number().nonnegative().default(0),
	month: z.number().nonnegative().default(0),
	year: z.number().nonnegative().default(0),
});

export const incomeRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select()
			.from(income)
			.orderBy(asc(income.person), asc(income.sortOrder), asc(income.source));
	}),

	create: protectedProcedure
		.input(incomeInput)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db.insert(income).values(input).returning();
			return row;
		}),

	update: protectedProcedure
		.input(incomeInput.extend({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(income)
				.set(values)
				.where(eq(income.id, id))
				.returning();
			return row;
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(income).where(eq(income.id, input.id));
			return { success: true };
		}),
});
