import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	notExists,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
	ExpenseConsumption,
	MatchCandidate,
	PossibleDuplicateReview,
	ReconcileCounts,
	ReconcilePlan,
	ReconcileReview,
	SyncedTransaction,
	Transaction,
	TransactionCreateInput,
	TransactionListQuery,
	TransactionSummary,
	TransactionUpdateInput,
	transactionSortBy,
	UnplannedWindow,
} from "~/domain/transactions";
import { PossibleDuplicateStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { possibleDuplicates, transactions } from "./transactions.schema";

export type TransactionLink = Pick<Transaction, "expenseId" | "categoryId">;
/** A row's bank-owned values, plus provenance to tell if it is synced. */
export type SyncedValues = Pick<Transaction, "provenance" | "amount" | "date">;
/** A synced row's write leaves out amount and date. */
export type TransactionPatch = Omit<
	TransactionUpdateInput,
	"id" | "amount" | "date"
> &
	Partial<Pick<TransactionUpdateInput, "amount" | "date">>;
export type TransactionDescription = Pick<Transaction, "id" | "description">;
/** Half-open `[from, to)`. */
export interface DateWindow {
	from: Date;
	to: Date;
}
/** What a receipt match ranks a row on. */
export type DatedTransaction = Pick<
	Transaction,
	"id" | "description" | "amount" | "date"
>;

type SyncedProvenance = SyncedTransaction["provenance"];
type Executor =
	| typeof realDb
	| Parameters<Parameters<typeof realDb.transaction>[0]>[0];

// One page of rows; total counts every match, not just this page
export interface TransactionPage {
	items: Transaction[];
	total: number;
}

export interface TransactionsRepository {
	list(query: TransactionListQuery): Promise<TransactionPage>;
	summary(): Promise<TransactionSummary>;
	insert(values: TransactionCreateInput): Promise<Transaction | undefined>;
	/** Bank ids among `externalIds` already in `transaction`. */
	findKnownExternalIds(
		provenance: SyncedProvenance,
		externalIds: string[],
	): Promise<string[]>;
	/** Every review of these bank ids, any status. */
	findReviews(
		provenance: SyncedProvenance,
		externalIds: string[],
	): Promise<ReconcileReview[]>;
	/**
	 * Rows dated in `[from, to)` a bank row may pair with: household rows, and bank
	 * rows of accounts not in `liveAccountIds`. None a kept review holds.
	 */
	findMatchCandidates(
		window: DateWindow & { liveAccountIds: string[] },
	): Promise<MatchCandidate[]>;
	/**
	 * One transaction. A refresh or add touches only bank-owned columns. An
	 * adoption whose row was claimed or deleted since the read adds its bank row.
	 */
	applyReconcile(plan: ReconcilePlan): Promise<ReconcileCounts>;
	/** Newest bank date first. */
	listPendingDuplicates(): Promise<PossibleDuplicateReview[]>;
	countPendingDuplicates(): Promise<number>;
	/** Each resolve acts only on a pending review; false when there is none. */
	keepMine(id: number): Promise<boolean>;
	useBanks(id: number): Promise<boolean>;
	bothReal(id: number): Promise<boolean>;
	/** `undefined` when no row has the id. */
	findSyncedValues(id: number): Promise<SyncedValues | undefined>;
	/** `undefined` when no row has the id. */
	update(
		id: number,
		values: TransactionPatch,
	): Promise<Transaction | undefined>;
	/** Unlinked Spend in the half-open `[from, to)` window. */
	findUnplanned(window: UnplannedWindow): Promise<Transaction[]>;
	findDescriptions(ids: number[]): Promise<TransactionDescription[]>;
	findInDateWindow(window: DateWindow): Promise<DatedTransaction[]>;
	/** `undefined` when no row has the id. */
	findLink(id: number): Promise<TransactionLink | undefined>;
	/** `undefined` when no row has the id. */
	setLink(id: number, link: TransactionLink): Promise<Transaction | undefined>;
	/** Adds every bank row a review holds on it first: the review is its only copy. */
	delete(id: number): Promise<void>;
	consumedByExpense(): Promise<ExpenseConsumption[]>;
	/** Every Transaction's date and amount: the cash flow actuals. */
	datedAmounts(): Promise<Pick<Transaction, "date" | "amount">[]>;
}

// The value the conflicting INSERT row tried to write.
const excluded = (column: PgColumn) =>
	sql`excluded.${sql.identifier(column.name)}`;

// The bank's half of a review, shaped as the row it would become.
const reviewBankRow = {
	provenance: possibleDuplicates.provenance,
	externalId: possibleDuplicates.externalId,
	externalAccountId: possibleDuplicates.externalAccountId,
	accountName: possibleDuplicates.accountName,
	amount: possibleDuplicates.amount,
	date: possibleDuplicates.date,
	description: possibleDuplicates.description,
};

const isPending = eq(
	possibleDuplicates.status,
	PossibleDuplicateStatus.Pending,
);

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

	async findKnownExternalIds(
		provenance: SyncedProvenance,
		externalIds: string[],
	): Promise<string[]> {
		if (!externalIds.length) return [];
		const rows = await this.db
			.select({ externalId: transactions.externalId })
			.from(transactions)
			.where(
				and(
					eq(transactions.provenance, provenance),
					inArray(transactions.externalId, externalIds),
				),
			);
		// The `in` filter drops null ids, but the column type stays nullable.
		return rows.map((r) => r.externalId as string);
	}

	async findReviews(
		provenance: SyncedProvenance,
		externalIds: string[],
	): Promise<ReconcileReview[]> {
		if (!externalIds.length) return [];
		return this.db
			.select({
				id: possibleDuplicates.id,
				externalId: possibleDuplicates.externalId,
				status: possibleDuplicates.status,
				transactionId: possibleDuplicates.transactionId,
			})
			.from(possibleDuplicates)
			.where(
				and(
					eq(possibleDuplicates.provenance, provenance),
					inArray(possibleDuplicates.externalId, externalIds),
				),
			);
	}

	findMatchCandidates({
		from,
		to,
		liveAccountIds,
	}: DateWindow & { liveAccountIds: string[] }): Promise<MatchCandidate[]> {
		const kept = alias(possibleDuplicates, "kept");
		return this.db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: transactions.amount,
				externalId: transactions.externalId,
				externalAccountId: transactions.externalAccountId,
				heldBy: possibleDuplicates.id,
			})
			.from(transactions)
			.leftJoin(
				possibleDuplicates,
				and(eq(possibleDuplicates.transactionId, transactions.id), isPending),
			)
			.where(
				and(
					gte(transactions.date, from),
					lt(transactions.date, to),
					or(
						isNull(transactions.externalId),
						and(
							isNotNull(transactions.externalAccountId),
							notInArray(transactions.externalAccountId, liveAccountIds),
						),
					),
					notExists(
						this.db
							.select({ id: kept.id })
							.from(kept)
							.where(
								and(
									eq(kept.transactionId, transactions.id),
									eq(kept.status, PossibleDuplicateStatus.Kept),
								),
							),
					),
				),
			);
	}

	applyReconcile(plan: ReconcilePlan): Promise<ReconcileCounts> {
		return this.db.transaction(async (tx) => {
			const extra: SyncedTransaction[] = [];
			let adopted = 0;
			let released = 0;
			for (const { transactionId, row, heldBy } of plan.adopt) {
				if (!(await this.adopt(tx, transactionId, row))) {
					extra.push(row);
					continue;
				}
				adopted++;
				if (heldBy === null) continue;
				// The household row is now the exact bank row, so the close one the
				// review held is another purchase.
				const taken = await this.takeReview(tx, heldBy);
				released += taken.length;
				extra.push(...taken.map(({ transactionId: _, ...bank }) => bank));
			}

			await this.upsertSynced(tx, [...plan.refresh, ...plan.add, ...extra]);

			const fresh = plan.flag.filter((f) => f.reviewId === null);
			const flagged = fresh.length
				? await tx
						.insert(possibleDuplicates)
						.values(
							fresh.map(({ transactionId, row }) => ({
								transactionId,
								...row,
							})),
						)
						.onConflictDoNothing({
							target: [
								possibleDuplicates.provenance,
								possibleDuplicates.externalId,
							],
						})
						.returning({ id: possibleDuplicates.id })
				: [];

			for (const { reviewId, row } of plan.flag) {
				if (reviewId === null) continue;
				// Not an upsert: a review resolved since the read must not come back.
				await tx
					.update(possibleDuplicates)
					.set({
						externalAccountId: row.externalAccountId,
						accountName: row.accountName,
						amount: row.amount,
						date: row.date,
						description: row.description,
					})
					.where(and(eq(possibleDuplicates.id, reviewId), isPending));
			}

			return {
				added: plan.add.length + extra.length,
				adopted,
				flagged: flagged.length - released,
				known:
					plan.refresh.length +
					plan.skipped.length +
					plan.flag.length -
					flagged.length,
			};
		});
	}

	listPendingDuplicates(): Promise<PossibleDuplicateReview[]> {
		return this.db
			.select({
				id: possibleDuplicates.id,
				bank: {
					date: possibleDuplicates.date,
					amount: possibleDuplicates.amount,
					description: possibleDuplicates.description,
					accountName: possibleDuplicates.accountName,
				},
				mine: {
					id: transactions.id,
					date: transactions.date,
					amount: transactions.amount,
					description: transactions.description,
					accountName: transactions.accountName,
					provenance: transactions.provenance,
				},
			})
			.from(possibleDuplicates)
			.innerJoin(
				transactions,
				eq(transactions.id, possibleDuplicates.transactionId),
			)
			.where(isPending)
			.orderBy(desc(possibleDuplicates.date), desc(possibleDuplicates.id));
	}

	async countPendingDuplicates(): Promise<number> {
		const [row] = await this.db
			.select({ count: sql<number>`cast(count(*) as int)` })
			.from(possibleDuplicates)
			.where(isPending);
		return row?.count ?? 0;
	}

	async keepMine(id: number): Promise<boolean> {
		const kept = await this.db
			.update(possibleDuplicates)
			.set({ status: PossibleDuplicateStatus.Kept })
			.where(and(eq(possibleDuplicates.id, id), isPending))
			.returning({ id: possibleDuplicates.id });
		return kept.length > 0;
	}

	useBanks(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const [review] = await this.takeReview(tx, id);
			if (!review) return false;
			const { transactionId, description: _, ...bank } = review;
			await tx
				.update(transactions)
				.set(bank)
				.where(eq(transactions.id, transactionId));
			return true;
		});
	}

	bothReal(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const [review] = await this.takeReview(tx, id);
			if (!review) return false;
			const { transactionId: _, ...bank } = review;
			await tx.insert(transactions).values(bank).onConflictDoNothing();
			return true;
		});
	}

	// A re-sync refreshes only the bank-owned columns. The description and member
	// edits (Expense link, Category, Group, notes) stay put.
	private async upsertSynced(
		db: Executor,
		rows: SyncedTransaction[],
	): Promise<void> {
		if (!rows.length) return;
		await db
			.insert(transactions)
			.values(rows)
			.onConflictDoUpdate({
				target: [transactions.provenance, transactions.externalId],
				// Postgres matches a partial unique index only when given its predicate.
				targetWhere: sql`${transactions.externalId} is not null`,
				set: {
					amount: excluded(transactions.amount),
					date: excluded(transactions.date),
					externalAccountId: excluded(transactions.externalAccountId),
					accountName: excluded(transactions.accountName),
				},
			});
	}

	// Guarded on a still-empty bank id, so a row claimed or deleted since the read
	// is left alone. Takes the bank's values; the member's edits stay.
	private async adopt(
		tx: Executor,
		id: number,
		{ description: _, ...bank }: SyncedTransaction,
	): Promise<boolean> {
		const adopted = await tx
			.update(transactions)
			.set(bank)
			.where(and(eq(transactions.id, id), isNull(transactions.externalId)))
			.returning({ id: transactions.id });
		return adopted.length > 0;
	}

	private takeReview(tx: Executor, id: number) {
		return tx
			.delete(possibleDuplicates)
			.where(and(eq(possibleDuplicates.id, id), isPending))
			.returning({
				...reviewBankRow,
				transactionId: possibleDuplicates.transactionId,
			});
	}

	async findSyncedValues(id: number): Promise<SyncedValues | undefined> {
		const [row] = await this.db
			.select({
				provenance: transactions.provenance,
				amount: transactions.amount,
				date: transactions.date,
			})
			.from(transactions)
			.where(eq(transactions.id, id));
		return row;
	}

	async update(
		id: number,
		values: TransactionPatch,
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

	findDescriptions(ids: number[]): Promise<TransactionDescription[]> {
		return this.db
			.select({ id: transactions.id, description: transactions.description })
			.from(transactions)
			.where(inArray(transactions.id, ids));
	}

	findInDateWindow(window: DateWindow): Promise<DatedTransaction[]> {
		return this.db
			.select({
				id: transactions.id,
				description: transactions.description,
				amount: transactions.amount,
				date: transactions.date,
			})
			.from(transactions)
			.where(
				and(
					gte(transactions.date, window.from),
					lt(transactions.date, window.to),
				),
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

	delete(id: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			const held = await tx
				.select(reviewBankRow)
				.from(possibleDuplicates)
				.where(eq(possibleDuplicates.transactionId, id));
			// A held bank row has no other copy, and sync never refetches an old date.
			if (held.length)
				await tx.insert(transactions).values(held).onConflictDoNothing();
			await tx.delete(transactions).where(eq(transactions.id, id));
		});
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
