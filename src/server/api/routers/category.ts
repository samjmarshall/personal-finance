import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type Category,
	categoryCreateDto,
	categoryReorderDto,
	categoryUpdateDto,
} from "~/domain/categories";
import { assertRow } from "~/server/api/lib/assert-row";
import { isPgViolation, PgViolation } from "~/server/api/lib/parse-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";

export const categoryRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }): Promise<Category[]> => {
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
		.input(categoryCreateDto)
		.mutation(async ({ ctx, input }): Promise<Category> => {
			// New categories sort last: one past the current highest sortOrder.
			// MAX (not count) — deletes can leave gaps; count would collide. Empty -> 0.
			const [next] = await ctx.db
				.select({
					sortOrder:
						sql<number>`coalesce(max(${expenseCategories.sortOrder}) + 1, 0)`.mapWith(
							Number,
						),
				})
				.from(expenseCategories);

			const values = {
				name: input.name.trim(),
				description: input.description?.trim() || null,
				sortOrder: next?.sortOrder ?? 0,
			};
			try {
				const [row] = await ctx.db
					.insert(expenseCategories)
					.values(values)
					.returning();

				return assertRow(row, "create category");
			} catch (error) {
				if (isPgViolation(error, PgViolation.UniqueViolation)) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A category with that name already exists.",
						cause: error,
					});
				}
				throw error;
			}
		}),

	update: protectedProcedure
		.input(categoryUpdateDto)
		.mutation(async ({ ctx, input }): Promise<Category> => {
			const { id, name, description } = input;

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

			const values = {
				name: name.trim(),
				description: description?.trim() || null,
			};

			try {
				const [row] = await ctx.db.transaction(async (tx) => {
					// Keep expenses referencing this category in sync when renamed.
					if (existing.name !== values.name) {
						await tx
							.update(expenses)
							.set({ category: values.name })
							.where(eq(expenses.category, existing.name));
					}
					return tx
						.update(expenseCategories)
						.set(values)
						.where(eq(expenseCategories.id, id))
						.returning();
				});

				return assertRow(row, "update category");
			} catch (error) {
				if (isPgViolation(error, PgViolation.UniqueViolation)) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "A category with that name already exists.",
						cause: error,
					});
				}
				throw error;
			}
		}),

	reorder: protectedProcedure
		.input(categoryReorderDto)
		.mutation(async ({ ctx, input }) => {
			// Persist the dragged order in one commit: sortOrder = position in ids.
			await ctx.db.transaction(async (tx) => {
				for (const [index, id] of input.ids.entries()) {
					await tx
						.update(expenseCategories)
						.set({ sortOrder: index })
						.where(eq(expenseCategories.id, id));
				}
			});
			return { success: true };
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
