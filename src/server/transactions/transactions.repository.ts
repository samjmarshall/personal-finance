import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	max,
	min,
	notExists,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
	AnswerInput,
	CurrentApply,
	DescriptionEmbedding,
	DuplicateApply,
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
import {
	Answer,
	DuplicateApplyStatus,
	PossibleDuplicateStatus,
} from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { buildOutboxEvent } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import {
	descriptionEmbeddings,
	duplicateApply,
	possibleDuplicates,
	transactions,
} from "./transactions.schema";

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
export type CachedEmbedding = Pick<
	DescriptionEmbedding,
	"description" | "embedding"
>;
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
	/**
	 * Newest bank date first. Leaves out rows of a running Apply updated after
	 * `activeSince`; a stamped row still listed is one its Apply didn't apply.
	 */
	listPendingDuplicates(activeSince: Date): Promise<PossibleDuplicateReview[]>;
	/** Counts the same rows the review list shows. */
	countPendingDuplicates(activeSince: Date): Promise<number>;
	/**
	 * One transaction: fails a running Apply idle since before `staleBefore`, adds
	 * the new one, stamps each Answer on its pending review, emits the event. A
	 * running Apply that isn't stale makes the insert hit a unique violation.
	 */
	startApply(answers: AnswerInput[], staleBefore: Date): Promise<CurrentApply>;
	/**
	 * Pending Answers of an Apply still running and touched after `activeSince`:
	 * Keep mine, then Both are real, then Use bank's; by id within each.
	 */
	nextApplyBatch(
		applyId: number,
		limit: number,
		activeSince: Date,
	): Promise<AnswerInput[]>;
	/**
	 * Resolves one Answer and counts it, in one transaction. False when the review
	 * is no longer pending on this Apply, or the Apply isn't running and touched
	 * after `activeSince`. A unique violation rolls back and throws.
	 */
	applyAnswer(
		applyId: number,
		answer: AnswerInput,
		activeSince: Date,
	): Promise<boolean>;
	/**
	 * Unstamps a review whose bank row another row holds, and counts it taken.
	 * False when it isn't stamped, or the Apply isn't live as in `applyAnswer`.
	 */
	releaseAnswer(
		applyId: number,
		id: number,
		activeSince: Date,
	): Promise<boolean>;
	/**
	 * Moves only a live running Apply to done; whatever wasn't applied or taken
	 * is gone. False when it wasn't live.
	 */
	finishApply(applyId: number, activeSince: Date): Promise<boolean>;
	/** Fails only a running Apply. */
	failApply(applyId: number, error: string): Promise<boolean>;
	/** The newest Apply, with its count of still-pending stamped reviews. */
	latestApply(): Promise<(DuplicateApply & { pending: number }) | undefined>;
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
	/** Every distinct description: the word-weight corpus (adr029). */
	listDescriptions(): Promise<string[]>;
	/** The cached ones among these cleaned descriptions; a miss is just absent. */
	findEmbeddings(
		model: string,
		descriptions: string[],
	): Promise<CachedEmbedding[]>;
	/** Skips a description `model` already has a vector for. */
	saveEmbeddings(model: string, rows: CachedEmbedding[]): Promise<void>;
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

const isRunning = eq(duplicateApply.status, DuplicateApplyStatus.Running);

// Postgres types a VALUES column from its first row, so each value is cast.
const STAMP_ALIAS = sql.raw("stamp");
const stampValues = (answers: AnswerInput[]) =>
	sql`(values ${sql.join(
		answers.map(
			({ id, answer }) => sql`(${id}::int, ${answer}::duplicate_answer)`,
		),
		sql`, `,
	)}) as ${STAMP_ALIAS}(id, answer)`;

const STALE_APPLY_ERROR = "No progress; failed by the next apply.";
// A match is a running Apply that's still moving, so it owns its rows.
const liveApply = (id: number | PgColumn, activeSince: Date) =>
	and(
		eq(duplicateApply.id, id),
		isRunning,
		gt(duplicateApply.updatedAt, activeSince),
	);

// Spend is a positive amount; a refund (negative) counts as 0 toward it.
const spendAmount = sql`case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end`;

interface DrizzleTransactionsRepositoryDeps {
	db: typeof realDb;
	outbox: OutboxWriteDoor;
}

export class DrizzleTransactionsRepository implements TransactionsRepository {
	private readonly db: typeof realDb;
	private readonly outbox: OutboxWriteDoor;

	constructor({ db, outbox }: DrizzleTransactionsRepositoryDeps) {
		this.db = db;
		this.outbox = outbox;
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

		if (query.frequency) {
			filters.push(eq(transactions.frequency, query.frequency));
		}

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
		// A row can hold several reviews (a same-day or closer-worded copy joins one); one row each here.
		const held = this.db
			.select({
				transactionId: possibleDuplicates.transactionId,
				id: min(possibleDuplicates.id).as("heldBy"),
				score: max(possibleDuplicates.descriptionScore).as("heldScore"),
			})
			.from(possibleDuplicates)
			.where(isPending)
			.groupBy(possibleDuplicates.transactionId)
			.as("held");

		return this.db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: transactions.amount,
				description: transactions.description,
				externalId: transactions.externalId,
				externalAccountId: transactions.externalAccountId,
				heldBy: held.id,
				heldScore: held.score,
			})
			.from(transactions)
			.leftJoin(held, eq(held.transactionId, transactions.id))
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
			// Added on top of plan.add: a bank row whose adopt missed, a released review's.
			const alsoAdd: SyncedTransaction[] = [];
			// A held review's bank row can come in this batch too; that copy is newer.
			const newerCopy = new Map<number, SyncedTransaction>();

			for (const { reviewId, row } of plan.flag) {
				if (reviewId !== null) newerCopy.set(reviewId, row);
			}

			const releasedIds = new Set<number>();
			let adopted = 0;
			let released = 0;

			for (const { transactionId, row, heldBy } of plan.adopt) {
				if (!(await this.adopt(tx, transactionId, row))) {
					alsoAdd.push(row);

					continue;
				}

				adopted++;

				if (heldBy === null) continue;

				// Row is now the exact bank row, so its other reviews were different purchases: release them.
				const taken = await this.takeReviewsOn(tx, transactionId);
				released += taken.length;

				for (const { id, ...bank } of taken) {
					releasedIds.add(id);
					alsoAdd.push(newerCopy.get(id) ?? bank);
				}
			}

			await this.upsertSynced(tx, [...plan.refresh, ...plan.add, ...alsoAdd]);

			const newFlags = plan.flag.filter((f) => f.reviewId === null);
			const inserted = newFlags.length
				? await tx
						.insert(possibleDuplicates)
						.values(
							newFlags.map(({ transactionId, row, descriptionScore }) => ({
								transactionId,
								...row,
								descriptionScore,
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

			const refreshedReviews = plan.flag.flatMap(({ reviewId, row }) =>
				reviewId === null || releasedIds.has(reviewId)
					? []
					: [{ reviewId, row }],
			);

			for (const { reviewId, row } of refreshedReviews) {
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

			// A new flag the insert skipped already has a review: known, not flagged.
			const alreadyFlagged = newFlags.length - inserted.length;

			return {
				added: plan.add.length + alsoAdd.length,
				adopted,
				flagged: inserted.length - released,
				known:
					plan.refresh.length +
					plan.skipped.length +
					refreshedReviews.length +
					alreadyFlagged,
			};
		});
	}

	listPendingDuplicates(activeSince: Date): Promise<PossibleDuplicateReview[]> {
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
				descriptionScore: possibleDuplicates.descriptionScore,
				answer: possibleDuplicates.answer,
				notApplied: sql<boolean>`${possibleDuplicates.applyId} is not null`,
			})
			.from(possibleDuplicates)
			.innerJoin(
				transactions,
				eq(transactions.id, possibleDuplicates.transactionId),
			)
			.leftJoin(
				duplicateApply,
				liveApply(possibleDuplicates.applyId, activeSince),
			)
			.where(and(isPending, isNull(duplicateApply.id)))
			.orderBy(desc(possibleDuplicates.date), desc(possibleDuplicates.id));
	}

	async countPendingDuplicates(activeSince: Date): Promise<number> {
		const [row] = await this.db
			.select({ count: sql<number>`cast(count(*) as int)` })
			.from(possibleDuplicates)
			.leftJoin(
				duplicateApply,
				liveApply(possibleDuplicates.applyId, activeSince),
			)
			.where(and(isPending, isNull(duplicateApply.id)));

		return row?.count ?? 0;
	}

	// The event carries the Apply id, known only after the insert, so the row,
	// its stamps and the event commit together.
	startApply(answers: AnswerInput[], staleBefore: Date): Promise<CurrentApply> {
		return this.outbox.commit(
			async (tx) => {
				await tx
					.update(duplicateApply)
					.set({
						status: DuplicateApplyStatus.Failed,
						error: STALE_APPLY_ERROR,
						finishedAt: new Date(),
					})
					.where(and(isRunning, lt(duplicateApply.updatedAt, staleBefore)));

				const [apply] = await tx
					.insert(duplicateApply)
					.values({ total: answers.length })
					.returning();

				if (!apply) throw new Error("startApply: no row returned");

				// The insert took the one running slot: older stamps are all stopped.
				const stamped = await tx
					.update(possibleDuplicates)
					.set({ applyId: apply.id, answer: sql`${STAMP_ALIAS}.answer` })
					.from(stampValues(answers))
					.where(
						and(eq(possibleDuplicates.id, sql`${STAMP_ALIAS}.id`), isPending),
					)
					.returning({ id: possibleDuplicates.id });

				return { ...apply, active: true, pending: stamped.length };
			},
			(apply) => [
				buildOutboxEvent("duplicate/apply.requested", { applyId: apply.id }),
			],
		);
	}

	async nextApplyBatch(
		applyId: number,
		limit: number,
		activeSince: Date,
	): Promise<AnswerInput[]> {
		const rows = await this.db
			.select({ id: possibleDuplicates.id, answer: possibleDuplicates.answer })
			.from(possibleDuplicates)
			.innerJoin(
				duplicateApply,
				liveApply(possibleDuplicates.applyId, activeSince),
			)
			.where(and(eq(possibleDuplicates.applyId, applyId), isPending))
			.orderBy(
				sql`case ${possibleDuplicates.answer} when ${Answer.KeepMine} then 0 when ${Answer.BothReal} then 1 else 2 end`,
				asc(possibleDuplicates.id),
			)
			.limit(limit);

		// A stamp always sets the answer, but the column type stays nullable.
		return rows.map((row) => ({ id: row.id, answer: row.answer as Answer }));
	}

	applyAnswer(
		applyId: number,
		answer: AnswerInput,
		activeSince: Date,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.lockLiveApply(tx, applyId, activeSince))) return false;
			if (!(await this.resolveAnswer(tx, answer, applyId))) return false;

			await tx
				.update(duplicateApply)
				.set({ applied: sql`${duplicateApply.applied} + 1` })
				.where(eq(duplicateApply.id, applyId));

			return true;
		});
	}

	releaseAnswer(
		applyId: number,
		id: number,
		activeSince: Date,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.lockLiveApply(tx, applyId, activeSince))) return false;

			const released = await tx
				.update(possibleDuplicates)
				.set({ applyId: null, answer: null })
				.where(
					and(
						eq(possibleDuplicates.id, id),
						eq(possibleDuplicates.applyId, applyId),
						isPending,
					),
				)
				.returning({ id: possibleDuplicates.id });

			if (!released.length) return false;

			await tx
				.update(duplicateApply)
				.set({ taken: sql`${duplicateApply.taken} + 1` })
				.where(eq(duplicateApply.id, applyId));

			return true;
		});
	}

	async finishApply(applyId: number, activeSince: Date): Promise<boolean> {
		const finished = await this.db
			.update(duplicateApply)
			.set({
				status: DuplicateApplyStatus.Done,
				gone: sql`${duplicateApply.total} - ${duplicateApply.applied} - ${duplicateApply.taken}`,
				finishedAt: new Date(),
			})
			.where(liveApply(applyId, activeSince))
			.returning({ id: duplicateApply.id });

		return finished.length > 0;
	}

	async failApply(applyId: number, error: string): Promise<boolean> {
		const failed = await this.db
			.update(duplicateApply)
			.set({
				status: DuplicateApplyStatus.Failed,
				error,
				finishedAt: new Date(),
			})
			.where(and(eq(duplicateApply.id, applyId), isRunning))
			.returning({ id: duplicateApply.id });

		return failed.length > 0;
	}

	async latestApply(): Promise<
		(DuplicateApply & { pending: number }) | undefined
	> {
		const [row] = await this.db
			.select({
				...getTableColumns(duplicateApply),
				pending: sql<number>`(select count(*)::int from ${possibleDuplicates} where ${and(
					eq(possibleDuplicates.applyId, duplicateApply.id),
					isPending,
				)})`,
			})
			.from(duplicateApply)
			.orderBy(desc(duplicateApply.id))
			.limit(1);

		return row;
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

	// Locks the Apply before its rows, as a start does, so a start failing it
	// waits for this Answer and every later Answer sees it stopped.
	private async lockLiveApply(
		tx: Executor,
		applyId: number,
		activeSince: Date,
	): Promise<boolean> {
		const [live] = await tx
			.select({ id: duplicateApply.id })
			.from(duplicateApply)
			.where(liveApply(applyId, activeSince))
			.for("update");

		return live !== undefined;
	}

	// Only a pending review its Apply still holds, so a late worker can't touch
	// a row a newer Apply took.
	private pendingReview(id: number, applyId: number) {
		return and(
			eq(possibleDuplicates.id, id),
			isPending,
			eq(possibleDuplicates.applyId, applyId),
		);
	}

	private resolveAnswer(
		tx: Executor,
		{ id, answer }: AnswerInput,
		applyId: number,
	): Promise<boolean> {
		switch (answer) {
			case Answer.KeepMine:
				return this.resolveKeepMine(tx, id, applyId);
			case Answer.UseBank:
				return this.resolveUseBank(tx, id, applyId);
			case Answer.BothReal:
				return this.resolveBothReal(tx, id, applyId);
		}
	}

	private async resolveKeepMine(
		tx: Executor,
		id: number,
		applyId: number,
	): Promise<boolean> {
		const kept = await tx
			.update(possibleDuplicates)
			.set({ status: PossibleDuplicateStatus.Kept })
			.where(this.pendingReview(id, applyId))
			.returning({ id: possibleDuplicates.id });

		return kept.length > 0;
	}

	private async resolveUseBank(
		tx: Executor,
		id: number,
		applyId: number,
	): Promise<boolean> {
		const [review] = await this.takeReview(tx, id, applyId);

		if (!review) return false;

		const { transactionId, description: _, ...bank } = review;
		await tx
			.update(transactions)
			.set(bank)
			.where(eq(transactions.id, transactionId));
		// The row is now that bank row, so any other review it held is another purchase.
		const others = await this.takeReviewsOn(tx, transactionId);

		if (others.length) {
			await tx
				.insert(transactions)
				.values(others.map(({ id: _, ...bank }) => bank))
				.onConflictDoNothing();
		}

		return true;
	}

	private async resolveBothReal(
		tx: Executor,
		id: number,
		applyId: number,
	): Promise<boolean> {
		const [review] = await this.takeReview(tx, id, applyId);

		if (!review) return false;

		const { transactionId: _, ...bank } = review;
		await tx.insert(transactions).values(bank).onConflictDoNothing();

		return true;
	}

	private takeReview(tx: Executor, id: number, applyId: number) {
		return tx
			.delete(possibleDuplicates)
			.where(this.pendingReview(id, applyId))
			.returning({
				...reviewBankRow,
				transactionId: possibleDuplicates.transactionId,
			});
	}

	/** Every pending review on the row, each as its bank row and review id. */
	private takeReviewsOn(tx: Executor, transactionId: number) {
		return tx
			.delete(possibleDuplicates)
			.where(
				and(eq(possibleDuplicates.transactionId, transactionId), isPending),
			)
			.returning({ ...reviewBankRow, id: possibleDuplicates.id });
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

	async listDescriptions(): Promise<string[]> {
		const rows = await this.db
			.selectDistinct({ description: transactions.description })
			.from(transactions);

		return rows.map((row) => row.description);
	}

	async findEmbeddings(
		model: string,
		descriptions: string[],
	): Promise<CachedEmbedding[]> {
		if (!descriptions.length) return [];

		return this.db
			.select({
				description: descriptionEmbeddings.description,
				embedding: descriptionEmbeddings.embedding,
			})
			.from(descriptionEmbeddings)
			.where(
				and(
					eq(descriptionEmbeddings.model, model),
					inArray(descriptionEmbeddings.description, descriptions),
				),
			);
	}

	async saveEmbeddings(model: string, rows: CachedEmbedding[]): Promise<void> {
		await this.db
			.insert(descriptionEmbeddings)
			.values(rows.map((row) => ({ model, ...row })))
			.onConflictDoNothing({
				target: [
					descriptionEmbeddings.model,
					descriptionEmbeddings.description,
				],
			});
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
			if (held.length) {
				await tx.insert(transactions).values(held).onConflictDoNothing();
			}

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
