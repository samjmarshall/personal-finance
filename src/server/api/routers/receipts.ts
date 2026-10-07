import { TRPCError } from "@trpc/server";
import { del } from "@vercel/blob";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	isNull,
	lt,
} from "drizzle-orm";
import { z } from "zod";
import {
	type MatchCandidate,
	matchCandidates,
	matchScanWindow,
	type Receipt,
	type ReceiptDetail,
	type ReceiptItem,
	type ReceiptListItem,
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
} from "~/domain/receipts";
import { env } from "~/env";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { posthogTraceUrl } from "~/lib/posthog-trace-url";
import { assertRow } from "~/server/api/lib/assert-row";
import { isPgViolation, PgViolation } from "~/server/api/lib/parse-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/auth/auth.schema";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import { categories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { buildOutboxEvent } from "~/server/inngest/events";
import { currentTraceId } from "~/server/observability/tracing/current-trace-id";
import { commitWithOutbox } from "~/server/outbox";
import { receiptItems, receipts } from "~/server/receipts/receipts.schema";
import { transactions } from "~/server/transactions/transactions.schema";

const byId = z.object({ id: z.number() });

// Attribution writes an expenseId or a categoryId; either FK can raise 23503
// if the member deleted the target in another tab.
const ITEM_FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";

export const receiptRouter = createTRPCRouter({
	// The producer for the receipt pipeline: the client has already put the file in
	// Blob and sends its coordinates; we persist a pending row (ownership + status
	// server-set) and emit receipt/uploaded so the worker extracts it. Row + event
	// commit together — the event id is the row's, known only after the insert.
	create: protectedProcedure
		.input(receiptCreateDto)
		.mutation(async ({ ctx, input }) =>
			commitWithOutbox(
				async (tx) => {
					const [row] = await tx
						.insert(receipts)
						.values({
							userId: ctx.session.user.id,
							status: ReceiptStatus.Pending,
							channel: ReceiptChannel.Upload,
							blobUrl: input.blobUrl,
							blobPathname: input.blobPathname,
							contentType: input.contentType,
							traceId: currentTraceId(),
						})
						.returning();
					return assertRow(row, "create receipt");
				},
				(row) => [buildOutboxEvent("receipt/uploaded", { receiptId: row.id })],
			),
		),

	// History table: newest first, with the uploading member and any matched
	// transaction resolved by name. The two filters are independent and mean exactly
	// what they say: `status` narrows by lifecycle, `unmatchedOnly` to rows with no
	// transaction yet (the to-do queue). Folding the second into the first would make
	// a matched receipt unreachable through every filter value.
	list: protectedProcedure
		.input(
			z
				.object({
					status: z.enum(ReceiptStatus).optional(),
					unmatchedOnly: z.boolean().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }): Promise<ReceiptListItem[]> => {
			return ctx.db
				.select({
					...getTableColumns(receipts),
					userName: user.name,
					transactionDescription: transactions.description,
				})
				.from(receipts)
				.leftJoin(user, eq(receipts.userId, user.id))
				.leftJoin(transactions, eq(receipts.transactionId, transactions.id))
				.where(
					// `and()` drops undefined arms, so no filter selected means no WHERE.
					and(
						input?.status ? eq(receipts.status, input.status) : undefined,
						input?.unmatchedOnly ? isNull(receipts.transactionId) : undefined,
					),
				)
				.orderBy(desc(receipts.createdAt), desc(receipts.id));
		}),

	// Detail overlay: the receipt plus its line items, each with its resolved
	// expense/category label (null until the member attributes it).
	get: protectedProcedure
		.input(byId)
		.query(async ({ ctx, input }): Promise<ReceiptDetail> => {
			const [receipt] = await ctx.db
				.select({
					...getTableColumns(receipts),
					transactionDescription: transactions.description,
				})
				.from(receipts)
				.leftJoin(transactions, eq(receipts.transactionId, transactions.id))
				.where(eq(receipts.id, input.id));
			if (!receipt)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt not found.",
				});

			const items = await ctx.db
				.select({
					...getTableColumns(receiptItems),
					expenseName: expenses.name,
					categoryName: categories.name,
				})
				.from(receiptItems)
				.leftJoin(expenses, eq(receiptItems.expenseId, expenses.id))
				.leftJoin(categories, eq(receiptItems.categoryId, categories.id))
				.where(eq(receiptItems.receiptId, input.id))
				.orderBy(asc(receiptItems.id));

			const traceUrl = posthogTraceUrl(
				{ uiHost: env.POSTHOG_UI_HOST, projectId: env.POSTHOG_PROJECT_ID },
				receipt.traceId,
			);

			return { ...receipt, traceUrl, items };
		}),

	// Re-run a stuck extraction. The conditional update (id AND status=failed) is
	// the guard: a missing or non-failed row matches nothing and 404s before any
	// event is minted — no re-spend on an already-processed receipt.
	retry: protectedProcedure.input(byId).mutation(async ({ input }) =>
		commitWithOutbox(
			async (tx) => {
				const [row] = await tx
					.update(receipts)
					// Overwrite the stale id: the retry run continues under a new trace, so
					// the deep-link must point at that run, not the failed original. Clear the
					// stale error too — it belongs to the prior run, and the diagnostics overlay
					// (and its "Copy all as JSON") would otherwise show a dead failure message
					// on the now-pending receipt.
					.set({
						status: ReceiptStatus.Pending,
						traceId: currentTraceId(),
						error: null,
					})
					.where(
						and(
							eq(receipts.id, input.id),
							eq(receipts.status, ReceiptStatus.Failed),
						),
					)
					.returning();
				if (!row)
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Receipt not found or not in a failed state.",
					});
				return row;
			},
			(row) => [buildOutboxEvent("receipt/retry", { receiptId: row.id })],
		),
	),

	// Destructive delete for a blurry/junk receipt. The row goes first (cascade
	// removes its items; the freed transaction slot lets another receipt match);
	// the blob is best-effort after — a leftover blob is harmless, a dangling row
	// is not, so cleanup never fails the mutation.
	delete: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
		const [row] = await ctx.db
			.select({ blobPathname: receipts.blobPathname })
			.from(receipts)
			.where(eq(receipts.id, input.id));
		if (!row)
			throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found." });

		// Block if copies dedup against this one: duplicateOfId is `set null` on delete,
		// so deleting the target would strand them as duplicates-of-nothing (no extracted
		// data, retry is failed-only) — a dead-end row. Make the member clear the copies first.
		const [dependent] = await ctx.db
			.select({ id: receipts.id })
			.from(receipts)
			.where(eq(receipts.duplicateOfId, input.id))
			.limit(1);
		if (dependent)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Delete the duplicate copies of this receipt first.",
			});

		await ctx.db.delete(receipts).where(eq(receipts.id, input.id));

		try {
			await del(row.blobPathname);
		} catch {
			// Leftover blob is harmless; the row (the thing that matters) is gone.
		}
		return { success: true };
	}),

	// Ranked suggestions for the detail banner. Read-time, never cached: a
	// transaction another receipt confirmed in the meantime drops out on the next
	// call, so two members can't be offered the same match.
	matchCandidates: protectedProcedure
		.input(receiptMatchDto)
		.query(async ({ ctx, input }): Promise<MatchCandidate[]> => {
			const [receipt] = await ctx.db
				.select({
					total: receipts.total,
					receiptDate: receipts.receiptDate,
				})
				.from(receipts)
				.where(eq(receipts.id, input.receiptId));
			if (!receipt)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt not found.",
				});

			// Nothing extracted to match on (still pending, or a failed read) — skip the
			// scan rather than pull a window we'd discard.
			const window = receipt.receiptDate
				? matchScanWindow(receipt.receiptDate)
				: null;
			if (receipt.total === null || !window) return [];

			const rows = await ctx.db
				.select({
					id: transactions.id,
					description: transactions.description,
					amount: transactions.amount,
					date: transactions.date,
					linkedReceiptId: receipts.id,
				})
				.from(transactions)
				.leftJoin(receipts, eq(receipts.transactionId, transactions.id))
				.where(
					and(
						gte(transactions.date, window.from),
						lt(transactions.date, window.to),
					),
				);

			return matchCandidates(
				receipt,
				rows.map(({ linkedReceiptId, ...t }) => ({
					...t,
					hasReceipt: linkedReceiptId !== null,
				})),
				input.timeZone,
			);
		}),

	// A member confirming the match the banner suggested — the only way a receipt
	// ever links to a transaction (adr010 / design decision 7: never silent).
	confirmMatch: protectedProcedure
		.input(receiptConfirmMatchDto)
		.mutation(async ({ ctx, input }): Promise<Receipt> => {
			let row: Receipt | undefined;
			try {
				// Update-or-404 in one statement, per the transaction router.
				[row] = await ctx.db
					.update(receipts)
					.set({ transactionId: input.transactionId })
					.where(eq(receipts.id, input.receiptId))
					.returning();
			} catch (error) {
				// The unique index on transactionId is the dup-photo catcher: two photos
				// of one purchase race here and the loser is told why, not 500'd.
				if (isPgViolation(error, PgViolation.UniqueViolation))
					throw new TRPCError({
						code: "CONFLICT",
						message: "That transaction already has a receipt.",
						cause: error,
					});
				rethrowFkConflict(error, "That transaction no longer exists.");
			}
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt not found.",
				});
			return row;
		}),

	// Per-item attribution: which planned expense this line belongs to. Null clears.
	setItemExpense: protectedProcedure
		.input(receiptItemExpenseDto)
		.mutation(async ({ ctx, input }): Promise<ReceiptItem> => {
			let row: ReceiptItem | undefined;
			try {
				[row] = await ctx.db
					.update(receiptItems)
					.set({ expenseId: input.expenseId })
					.where(eq(receiptItems.id, input.itemId))
					.returning();
			} catch (error) {
				rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE);
			}
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt item not found.",
				});
			return row;
		}),

	// Per-item attribution against the managed category list. Null clears.
	setItemCategory: protectedProcedure
		.input(receiptItemCategoryDto)
		.mutation(async ({ ctx, input }): Promise<ReceiptItem> => {
			let row: ReceiptItem | undefined;
			try {
				[row] = await ctx.db
					.update(receiptItems)
					.set({ categoryId: input.categoryId })
					.where(eq(receiptItems.id, input.itemId))
					.returning();
			} catch (error) {
				rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE);
			}
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Receipt item not found.",
				});
			return row;
		}),
});
