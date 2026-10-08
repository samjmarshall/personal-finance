import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
	ExpenseConsumption,
	Transaction,
	TransactionCreateInput,
	TransactionListQuery,
	TransactionSummary,
	TransactionUpdateInput,
	transactionSortBy,
	UnplannedWindow,
} from "~/domain/transactions";
import type { db as realDb } from "~/server/db";
import { transactions } from "./transactions.schema";

export type TransactionLink = Pick<Transaction, "expenseId" | "categoryId">;

// One page of rows; total counts every match, not just this page
export interface TransactionPage {
	items: Transaction[];
	total: number;
}

export interface TransactionsRepository {
	list(query: TransactionListQuery): Promise<TransactionPage>;
	summary(): Promise<TransactionSummary>;
	insert(values: TransactionCreateInput): Promise<Transaction | undefined>;
	/** `undefined` when no row has the id. */
	update(
		id: number,
		values: Omit<TransactionUpdateInput, "id">,
	): Promise<Transaction | undefined>;
	/** Unlinked Spend in the half-open `[from, to)` window. */
	findUnplanned(window: UnplannedWindow): Promise<Transaction[]>;
	/** `undefined` when no row has the id. */
	findLink(id: number): Promise<TransactionLink | undefined>;
	/** `undefined` when no row has the id. */
	setLink(id: number, link: TransactionLink): Promise<Transaction | undefined>;
	delete(id: number): Promise<void>;
	consumedByExpense(): Promise<ExpenseConsumption[]>;
	/** Every Transaction's date and amount: the cash flow actuals. */
	datedAmounts(): Promise<Pick<Transaction, "date" | "amount">[]>;
}

// Spend is a positive amount; a refund (negative) counts as 0 toward it.
const spendAmount = sql`case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end`;

interface DrizzleTransactionsRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleTransactionsRepository implements TransactionsRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleTransactionsRepositoryDeps) {
		this.db = db;
	}

	async list(query: TransactionListQuery): Promise<TransactionPage> {
		const filters: SQL[] = [];

		if (query.search) {
			const term = `%${query.search}%`;
			const clause = or(
				ilike(transactions.description, term),
				ilike(transactions.group, term),
				ilike(transactions.notes, term),
			);
			if (clause) filters.push(clause);
		}
		if (query.priority) filters.push(eq(transactions.priority, query.priority));
		if (query.frequency)
			filters.push(eq(transactions.frequency, query.frequency));
		if (query.group) filters.push(eq(transactions.group, query.group));
		if (query.from) filters.push(gte(transactions.date, query.from));
		if (query.to) filters.push(lte(transactions.date, query.to));

		const where = filters.length ? and(...filters) : undefined;

		const sortableColumns: Record<
			z.infer<typeof transactionSortBy>,
			PgColumn
		> = {
			date: transactions.date,
			description: transactions.description,
			amount: transactions.amount,
			group: transactions.group,
			priority: transactions.priority,
		};
		const orderCol = sortableColumns[query.sortBy];
		const orderBy = query.sortDir === "asc" ? asc(orderCol) : desc(orderCol);

		const [items, countResult] = await Promise.all([
			this.db
				.select()
				.from(transactions)
				.where(where)
				.orderBy(orderBy, desc(transactions.id))
				.limit(query.limit)
				.offset(query.offset),
			this.db
				.select({ count: sql<number>`cast(count(*) as int)` })
				.from(transactions)
				.where(where),
		]);

		return {
			items,
			total: countResult[0]?.count ?? 0,
		};
	}

	async summary(): Promise<TransactionSummary> {
		const [totalsRows, byPriority, byFrequency, byMonth, topGroups] =
			await Promise.all([
				this.db
					.select({
						spend: sql<number>`coalesce(sum(${spendAmount}), 0)`,
						refunds: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), 0)`,
						net: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
						count: sql<number>`cast(count(*) as int)`,
					})
					.from(transactions),
				this.db
					.select({
						priority: transactions.priority,
						total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
						count: sql<number>`cast(count(*) as int)`,
					})
					.from(transactions)
					.groupBy(transactions.priority),
				this.db
					.select({
						frequency: transactions.frequency,
						total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
						count: sql<number>`cast(count(*) as int)`,
					})
					.from(transactions)
					.groupBy(transactions.frequency),
				this.db
					.select({
						month: sql<string>`to_char(date_trunc('month', ${transactions.date}), 'YYYY-MM')`,
						total: sql<number>`coalesce(sum(${spendAmount}), 0)`,
					})
					.from(transactions)
					.groupBy(sql`date_trunc('month', ${transactions.date})`)
					.orderBy(sql`date_trunc('month', ${transactions.date})`),
				this.db
					.select({
						group: transactions.group,
						total: sql<number>`coalesce(sum(${spendAmount}), 0)`,
						count: sql<number>`cast(count(*) as int)`,
					})
					.from(transactions)
					.groupBy(transactions.group)
					.orderBy(desc(sql`sum(${spendAmount})`))
					.limit(8),
			]);
		const totals = totalsRows[0];

		return {
			totals: totals ?? { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority,
			byFrequency,
			byMonth,
			topGroups,
		};
	}

	async insert(
		values: TransactionCreateInput,
	): Promise<Transaction | undefined> {
		const [row] = await this.db.insert(transactions).values(values).returning();
		return row;
	}

	async update(
		id: number,
		values: Omit<TransactionUpdateInput, "id">,
	): Promise<Transaction | undefined> {
		const [row] = await this.db
			.update(transactions)
			.set(values)
			.where(eq(transactions.id, id))
			.returning();
		return row;
	}

	// Unplanned = unlinked Spend in the window: amount > 0 AND expenseId IS NULL
	// (adr010). Refunds (amount < 0) are Inflow, not Spend, so they're excluded;
	// no pagination (period volume is small).
	async findUnplanned(window: UnplannedWindow): Promise<Transaction[]> {
		return (
			this.db
				.select()
				.from(transactions)
				.where(
					and(
						gt(transactions.amount, 0),
						isNull(transactions.expenseId),
						gte(transactions.date, window.from),
						lt(transactions.date, window.to),
					),
				)
				// Last tiebreak on id, so rows with the same Category and date keep
				// one order across refetches.
				.orderBy(
					asc(transactions.categoryId),
					desc(transactions.date),
					desc(transactions.id),
				)
		);
	}

	async findLink(id: number): Promise<TransactionLink | undefined> {
		const [row] = await this.db
			.select({
				expenseId: transactions.expenseId,
				categoryId: transactions.categoryId,
			})
			.from(transactions)
			.where(eq(transactions.id, id));
		return row;
	}

	async setLink(
		id: number,
		link: TransactionLink,
	): Promise<Transaction | undefined> {
		const [row] = await this.db
			.update(transactions)
			.set(link)
			.where(eq(transactions.id, id))
			.returning();
		return row;
	}

	async delete(id: number): Promise<void> {
		await this.db.delete(transactions).where(eq(transactions.id, id));
	}

	// Lifetime Consumed per Expense, for the Planned page. The sum nets refunds
	// (negative Inflow) against Spend, per glossary signs.
	async consumedByExpense(): Promise<ExpenseConsumption[]> {
		const rows = await this.db
			.select({
				expenseId: transactions.expenseId,
				consumed: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(
					Number,
				),
			})
			.from(transactions)
			.where(isNotNull(transactions.expenseId))
			.groupBy(transactions.expenseId);
		// The filter drops unlinked rows, but the column type stays nullable.
		return rows.map((r) => ({
			expenseId: r.expenseId as number,
			consumed: r.consumed,
		}));
	}

	datedAmounts(): Promise<Pick<Transaction, "date" | "amount">[]> {
		return this.db
			.select({ date: transactions.date, amount: transactions.amount })
			.from(transactions);
	}
}
