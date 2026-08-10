import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";

const categoryInput = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	sortOrder: z.number().int().default(0),
});

export const categoryRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select({
				id: expenseCategories.id,
				name: expenseCategories.name,
				description: expenseCategories.description,
				sortOrder: expenseCategories.sortOrder,
				createdAt: expenseCategories.createdAt,
				updatedAt: expenseCategories.updatedAt,
				expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number),
			})
			.from(expenseCategories)
			.leftJoin(expenses, eq(expenses.category, expenseCategories.name))
			.groupBy(expenseCategories.id)
			.orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
		return rows;
	}),

	create: protectedProcedure
		.input(categoryInput)
		.mutation(async ({ ctx, input }) => {
			const values = {
				name: input.name.trim(),
				description: input.description?.trim() || null,
				sortOrder: input.sortOrder,
			};
			try {
				const [row] = await ctx.db
					.insert(expenseCategories)
					.values(values)
					.returning();
				return row;
			} catch {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A category with that name already exists.",
				});
			}
		}),

	update: protectedProcedure
		.input(categoryInput.extend({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const { id, name, description, sortOrder } = input;

			const [existing] = await ctx.db
				.select()
				.from(expenseCategories)
				.where(eq(expenseCategories.id, id));
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Category not found.",
				});
			}

			const nextName = name.trim();
			const values = {
				name: nextName,
				description: description?.trim() || null,
				sortOrder,
			};

			try {
				const [row] = await ctx.db.transaction(async (tx) => {
					// Keep expenses referencing this category in sync when renamed.
					if (existing.name !== nextName) {
						await tx
							.update(expenses)
							.set({ category: nextName })
							.where(eq(expenses.category, existing.name));
					}
					return tx
						.update(expenseCategories)
						.set(values)
						.where(eq(expenseCategories.id, id))
						.returning();
				});
				return row;
			} catch {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A category with that name already exists.",
				});
			}
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const [existing] = await ctx.db
				.select()
				.from(expenseCategories)
				.where(eq(expenseCategories.id, input.id));
			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Category not found.",
				});
			}

			const [countRow] = await ctx.db
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(expenses)
				.where(eq(expenses.category, existing.name));
			const count = countRow?.count ?? 0;

			if (count > 0) {
				throw new TRPCError({
					code: "CONFLICT",
					message: `Cannot delete "${existing.name}" — ${count} expense${
						count === 1 ? "" : "s"
					} still use it.`,
				});
			}

			await ctx.db
				.delete(expenseCategories)
				.where(eq(expenseCategories.id, input.id));
			return { success: true };
		}),
});
