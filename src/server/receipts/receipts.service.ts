import {
	type MatchCandidate,
	matchCandidates,
	matchScanWindow,
	type Receipt,
	type ReceiptCreateInput,
	type ReceiptDetail,
	type ReceiptItem,
	type ReceiptListItem,
} from "~/domain/receipts";
import { ReceiptChannel } from "~/lib/constants";
import { type PosthogUiConfig, posthogTraceUrl } from "~/lib/posthog-trace-url";
import type { MembersService } from "~/server/auth/members.service";
import type { BlobStore } from "~/server/blob-store/blob-store";
import type { CategoriesService } from "~/server/categories/categories.service";
import { assertRow } from "~/server/errors/assert-row";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { rethrowFkConflict } from "~/server/errors/fk-conflict";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import { currentTraceId } from "~/server/observability/tracing/current-trace-id";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import type { ReceiptFilter, ReceiptsRepository } from "./receipts.repository";

const NOT_FOUND_MESSAGE = "Receipt not found.";
const ITEM_NOT_FOUND_MESSAGE = "Receipt item not found.";
// Picking an Expense or Category can fail if another tab just deleted it.
const ITEM_FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";

const distinctIds = <T>(ids: (T | null)[]) => [
	...new Set(ids.filter((id): id is T => id !== null)),
];

const entryOf = <K, V>(entries: ReadonlyMap<K, V>, id: K | null) =>
	id === null ? undefined : entries.get(id);

// Receipts → Members, Transactions, Expenses and Categories are downward calls
// (adr022).
interface ReceiptsServiceDeps {
	repository: ReceiptsRepository;
	members: Pick<MembersService, "namesByIds">;
	transactions: Pick<TransactionsService, "descriptionsByIds" | "inDateWindow">;
	expenses: Pick<ExpensesService, "namesByIds">;
	categories: Pick<CategoriesService, "namesByIds">;
	blobStore: Pick<BlobStore, "delete">;
	posthogUi: PosthogUiConfig;
}

export class ReceiptsService {
	private readonly repository: ReceiptsRepository;
	private readonly members: Pick<MembersService, "namesByIds">;
	private readonly transactions: Pick<
		TransactionsService,
		"descriptionsByIds" | "inDateWindow"
	>;
	private readonly expenses: Pick<ExpensesService, "namesByIds">;
	private readonly categories: Pick<CategoriesService, "namesByIds">;
	private readonly blobStore: Pick<BlobStore, "delete">;
	private readonly posthogUi: PosthogUiConfig;

	constructor({
		repository,
		members,
		transactions,
		expenses,
		categories,
		blobStore,
		posthogUi,
	}: ReceiptsServiceDeps) {
		this.repository = repository;
		this.members = members;
		this.transactions = transactions;
		this.expenses = expenses;
		this.categories = categories;
		this.blobStore = blobStore;
		this.posthogUi = posthogUi;
	}

	// Client uploads the file first. Owner and channel come from the server, never
	// the client.
	async create(memberId: string, input: ReceiptCreateInput): Promise<Receipt> {
		const [row] = await this.repository.insertPending(
			[
				{
					userId: memberId,
					channel: ReceiptChannel.Upload,
					blobUrl: input.blobUrl,
					blobPathname: input.blobPathname,
					contentType: input.contentType,
					traceId: currentTraceId(),
				},
			],
			"receipt/uploaded",
		);
		return assertRow(row, "create receipt");
	}

	// Status and "unmatched only" stack. Kept apart so a matched receipt can still
	// be listed.
	async list(filter: ReceiptFilter): Promise<ReceiptListItem[]> {
		const rows = await this.repository.findAll(filter);
		const [memberNames, descriptions] = await Promise.all([
			this.members.namesByIds(distinctIds(rows.map((row) => row.userId))),
			this.transactions.descriptionsByIds(
				distinctIds(rows.map((row) => row.transactionId)),
			),
		]);
		return rows.map((row) => ({
			...row,
			userName: entryOf(memberNames, row.userId) ?? null,
			transactionDescription: entryOf(descriptions, row.transactionId) ?? null,
		}));
	}

	// An item's Category is its own pick, never its Expense's.
	async get(id: number): Promise<ReceiptDetail> {
		const receipt = await this.repository.findById(id);
		if (!receipt) throw new NotFoundError(NOT_FOUND_MESSAGE);
		const items = await this.repository.findItems(id);
		const [descriptions, expenses, categoryNames] = await Promise.all([
			this.transactions.descriptionsByIds(distinctIds([receipt.transactionId])),
			this.expenses.namesByIds(
				distinctIds(items.map((item) => item.expenseId)),
			),
			this.categories.namesByIds(
				distinctIds(items.map((item) => item.categoryId)),
			),
		]);
		return {
			...receipt,
			transactionDescription:
				entryOf(descriptions, receipt.transactionId) ?? null,
			traceUrl: posthogTraceUrl(this.posthogUi, receipt.traceId),
			items: items.map((item) => ({
				...item,
				expenseName: entryOf(expenses, item.expenseId)?.name ?? null,
				categoryName: entryOf(categoryNames, item.categoryId) ?? null,
			})),
		};
	}

	async retry(id: number): Promise<Receipt> {
		const row = await this.repository.requeueFailed(id, currentTraceId());
		if (!row) {
			throw new NotFoundError("Receipt not found or not in a failed state.");
		}
		return row;
	}

	// The row goes first: its items cascade, and the freed transaction can match
	// another receipt. The file goes after, so cleanup never fails the delete.
	async delete(id: number): Promise<void> {
		const deletion = await this.repository.deleteUnlessDuplicated(id);
		if (deletion === "missing") throw new NotFoundError(NOT_FOUND_MESSAGE);
		if (deletion === "has-duplicates") {
			throw new ConflictError(
				"Delete the duplicate copies of this receipt first.",
			);
		}
		try {
			await this.blobStore.delete(deletion.blobPathname);
		} catch {
			// A leftover file is harmless; the row (the thing that matters) is gone.
		}
	}

	// Read-time, never cached: a transaction another receipt confirmed meanwhile
	// drops out on the next call, so two members can't be offered the same match.
	async matchCandidates(
		receiptId: number,
		timeZone: string,
	): Promise<MatchCandidate[]> {
		const receipt = await this.repository.findMatchInput(receiptId);
		if (!receipt) throw new NotFoundError(NOT_FOUND_MESSAGE);
		// Nothing extracted to match on yet: skip a scan we'd discard.
		const window = receipt.receiptDate
			? matchScanWindow(receipt.receiptDate)
			: null;
		if (receipt.total === null || !window) return [];
		const rows = await this.transactions.inDateWindow(window);
		const matched = new Set(
			await this.repository.findMatchedTransactionIds(
				rows.map((row) => row.id),
			),
		);
		return matchCandidates(
			receipt,
			rows.map((row) => ({ ...row, hasReceipt: matched.has(row.id) })),
			timeZone,
		);
	}

	// A member confirming the banner's suggestion is the only way a receipt links
	// to a transaction (adr010: never silent).
	async confirmMatch(
		receiptId: number,
		transactionId: number,
	): Promise<Receipt> {
		const row = await this.repository
			.setTransaction(receiptId, transactionId)
			.catch((error: unknown) => {
				// Two photos of one purchase can race for the same transaction. Loser
				// gets a clear conflict, not a 500.
				if (isPgViolation(error, PgViolation.UniqueViolation)) {
					throw new ConflictError("That transaction already has a receipt.", {
						cause: error,
					});
				}
				return rethrowFkConflict(error, "That transaction no longer exists.");
			});
		if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
		return row;
	}

	// Null unlinks.
	async setItemExpense(
		itemId: number,
		expenseId: number | null,
	): Promise<ReceiptItem> {
		const row = await this.repository
			.setItemExpense(itemId, expenseId)
			.catch((error: unknown) =>
				rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE),
			);
		if (!row) throw new NotFoundError(ITEM_NOT_FOUND_MESSAGE);
		return row;
	}

	// Null unlinks.
	async setItemCategory(
		itemId: number,
		categoryId: number | null,
	): Promise<ReceiptItem> {
		const row = await this.repository
			.setItemCategory(itemId, categoryId)
			.catch((error: unknown) =>
				rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE),
			);
		if (!row) throw new NotFoundError(ITEM_NOT_FOUND_MESSAGE);
		return row;
	}
}
