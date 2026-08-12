import {
	and,
	asc,
	desc,
	eq,
	gte,
	ilike,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { transactions } from "~/server/transactions/transactions.schema";

const sortableColumns = {
	date: transactions.date,
	description: transactions.description,
	amount: transactions.amount,
	category: transactions.category,
	priority: transactions.priority,
} as const;

const transactionInput = z.object({
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	category: z.string().min(1).default("Uncategorised"),
	frequency: z.string().min(1).default("One-off"),
	priority: z.string().min(1).default("Nice to Have"),
	notes: z.string().nullable().optional(),
});

const listInput = z.object({
	search: z.string().optional(),
	priority: z.string().optional(),
	frequency: z.string().optional(),
	category: z.string().optional(),
	from: z.date().optional(),
	to: z.date().optional(),
	sortBy: z
		.enum(["date", "description", "amount", "category", "priority"])
		.default("date"),
	sortDir: z.enum(["asc", "desc"]).default("desc"),
	limit: z.number().min(1).max(200).default(50),
	offset: z.number().min(0).default(0),
});

function buildFilters(input: z.infer<typeof listInput>): SQL[] {
	const filters: SQL[] = [];
	if (input.search) {
		const term = `%${input.search}%`;
		const clause = or(
			ilike(transactions.description, term),
			ilike(transactions.category, term),
			ilike(transactions.notes, term),
		);
		if (clause) filters.push(clause);
	}
	if (input.priority) filters.push(eq(transactions.priority, input.priority));
	if (input.frequency)
		filters.push(eq(transactions.frequency, input.frequency));
	if (input.category) filters.push(eq(transactions.category, input.category));
	if (input.from) filters.push(gte(transactions.date, input.from));
	if (input.to) filters.push(lte(transactions.date, input.to));
	return filters;
}

export const transactionRouter = createTRPCRouter({
	list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
		const filters = buildFilters(input);
		const where = filters.length ? and(...filters) : undefined;
		const orderCol = sortableColumns[input.sortBy];
		const orderBy = input.sortDir === "asc" ? asc(orderCol) : desc(orderCol);

		const [items, countResult] = await Promise.all([
			ctx.db
				.select()
				.from(transactions)
				.where(where)
				.orderBy(orderBy, desc(transactions.id))
				.limit(input.limit)
				.offset(input.offset),
			ctx.db
				.select({ count: sql<number>`cast(count(*) as int)` })
				.from(transactions)
				.where(where),
		]);

		return {
			items,
			total: countResult[0]?.count ?? 0,
		};
	}),

	summary: protectedProcedure.query(async ({ ctx }) => {
		const [totals] = await ctx.db
			.select({
				spend: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
				refunds: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
				net: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
				count: sql<number>`cast(count(*) as int)`,
			})
			.from(transactions);

		const byPriority = await ctx.db
			.select({
				priority: transactions.priority,
				total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
				count: sql<number>`cast(count(*) as int)`,
			})
			.from(transactions)
			.groupBy(transactions.priority);

		const byFrequency = await ctx.db
			.select({
				frequency: transactions.frequency,
				total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
				count: sql<number>`cast(count(*) as int)`,
			})
			.from(transactions)
			.groupBy(transactions.frequency);

		const byMonth = await ctx.db
			.select({
				month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
				total: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
			})
			.from(transactions)
			.groupBy(sql`date_trunc('month', ${transactions.date})`)
			.orderBy(sql`date_trunc('month', ${transactions.date})`);

		const topCategories = await ctx.db
			.select({
				category: transactions.category,
				total: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
				count: sql<number>`cast(count(*) as int)`,
			})
			.from(transactions)
			.groupBy(transactions.category)
			.orderBy(
				desc(
					sql`sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end)`,
				),
			)
			.limit(8);

		return {
			totals: totals ?? { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority,
			byFrequency,
			byMonth,
			topCategories,
		};
	}),

	create: protectedProcedure
		.input(transactionInput)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.insert(transactions)
				.values({ ...input, notes: input.notes ?? null })
				.returning();
			return row;
		}),

	update: protectedProcedure
		.input(transactionInput.extend({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const { id, ...values } = input;
			const [row] = await ctx.db
				.update(transactions)
				.set({ ...values, notes: values.notes ?? null })
				.where(eq(transactions.id, id))
				.returning();
			return row;
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.delete(transactions).where(eq(transactions.id, input.id));
			return { success: true };
		}),
});
