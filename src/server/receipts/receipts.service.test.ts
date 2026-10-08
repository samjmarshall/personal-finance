import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	matchScanWindow,
	type Receipt,
	type ReceiptItem,
} from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { MembersService } from "~/server/auth/members.service";
import type { BlobStore } from "~/server/blob-store/blob-store";
import type { CategoriesService } from "~/server/categories/categories.service";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import {
	expectPlainError,
	failedQuery,
	recorder,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { ReceiptsRepository } from "./receipts.repository";
import { ReceiptsService } from "./receipts.service";

// No tracer set up means no trace id. Register one to prove it reaches the row.
const provider = new NodeTracerProvider();
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());

function inSpan<T>(run: () => Promise<T>) {
	const span = trace.getTracer("test").startSpan("receipts");
	return {
		traceId: span.spanContext().traceId,
		result: context.with(trace.setSpan(context.active(), span), run),
	};
}

interface Staged {
	repository?: Partial<ReceiptsRepository>;
	members?: Partial<Pick<MembersService, "namesByIds">>;
	transactions?: Partial<
		Pick<TransactionsService, "descriptionsByIds" | "inDateWindow">
	>;
	expenses?: Partial<Pick<ExpensesService, "namesByIds">>;
	categories?: Partial<Pick<CategoriesService, "namesByIds">>;
	blobStore?: Partial<Pick<BlobStore, "delete">>;
	projectId?: string;
}

function serviceWith(staged: Staged = {}) {
	return new ReceiptsService({
		repository: {
			insertPending: unstaged,
			findAll: unstaged,
			findById: unstaged,
			findItems: unstaged,
			requeueFailed: unstaged,
			findBlobPathname: unstaged,
			deleteUnlessDuplicated: unstaged,
			findMatchInput: unstaged,
			findMatchedTransactionIds: unstaged,
			setTransaction: unstaged,
			setItemExpense: unstaged,
			setItemCategory: unstaged,
			...staged.repository,
		},
		members: { namesByIds: unstaged, ...staged.members },
		transactions: {
			descriptionsByIds: unstaged,
			inDateWindow: unstaged,
			...staged.transactions,
		},
		expenses: { namesByIds: unstaged, ...staged.expenses },
		categories: { namesByIds: unstaged, ...staged.categories },
		blobStore: { delete: unstaged, ...staged.blobStore },
		posthogUi: {
			uiHost: "https://us.posthog.com",
			projectId: "projectId" in staged ? staged.projectId : "123",
		},
	});
}

const RECEIPT: Receipt = {
	id: 42,
	status: ReceiptStatus.Processed,
	channel: ReceiptChannel.Upload,
	userId: "member-1",
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: "Coles",
	receiptDate: "2026-09-10",
	total: 42.5,
	currency: "AUD",
	rawJson: null,
	error: null,
	traceId: "trace-abc",
	transactionId: 3,
	duplicateOfId: null,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
};

const ITEM: ReceiptItem = {
	id: 5,
	receiptId: 42,
	name: "Milk",
	price: 3.5,
	quantity: 1,
	expenseId: 7,
	categoryId: 4,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
};

const UPLOAD = {
	blobUrl: RECEIPT.blobUrl,
	blobPathname: RECEIPT.blobPathname,
	contentType: "image/jpeg",
};

const ITEM_FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";

describe("create", () => {
	it("mints one pending upload owned by the member, under the ambient trace", async () => {
		const { method, calls } = recorder([RECEIPT]);
		const service = serviceWith({ repository: { insertPending: method } });

		const { traceId, result } = inSpan(() =>
			service.create("member-1", UPLOAD),
		);

		await expect(result).resolves.toBe(RECEIPT);
		expect(calls).toEqual([
			[
				[
					{
						userId: "member-1",
						channel: ReceiptChannel.Upload,
						...UPLOAD,
						traceId,
					},
				],
				"receipt/uploaded",
			],
		]);
	});

	it("throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({
			repository: { insertPending: async () => [] },
		});

		const thrown = await service
			.create("member-1", UPLOAD)
			.catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to create receipt.");
	});
});

describe("list", () => {
	function listing(
		rows: Receipt[],
		{
			memberNames = new Map([["member-1", "Sam"]]),
			descriptions = new Map([[3, "COLES 123"]]),
		} = {},
	) {
		const asked: unknown[][] = [];
		const filters: unknown[] = [];
		const service = serviceWith({
			repository: {
				findAll: async (filter) => {
					filters.push(filter);
					return rows;
				},
			},
			members: {
				namesByIds: async (ids) => {
					asked.push(["members", ids]);
					return memberNames;
				},
			},
			transactions: {
				descriptionsByIds: async (ids) => {
					asked.push(["transactions", ids]);
					return descriptions;
				},
			},
		});
		return { service, asked, filters };
	}

	it("passes the filter through and merges the names onto each row", async () => {
		const { service, filters } = listing([RECEIPT]);
		const filter = { status: ReceiptStatus.Processed, unmatchedOnly: false };

		await expect(service.list(filter)).resolves.toEqual([
			{ ...RECEIPT, userName: "Sam", transactionDescription: "COLES 123" },
		]);
		expect(filters).toEqual([filter]);
	});

	it("asks each lookup once, with distinct ids", async () => {
		const { service, asked } = listing([RECEIPT, { ...RECEIPT, id: 43 }]);

		await service.list({});

		expect(asked).toEqual(
			expect.arrayContaining([
				["members", ["member-1"]],
				["transactions", [3]],
			]),
		);
		expect(asked).toHaveLength(2);
	});

	it("gives an unowned, unmatched row null names and never asks for them", async () => {
		const { service, asked } = listing([
			{ ...RECEIPT, userId: null, transactionId: null },
		]);

		await expect(service.list({})).resolves.toEqual([
			expect.objectContaining({ userName: null, transactionDescription: null }),
		]);
		expect(asked).toEqual(
			expect.arrayContaining([
				["members", []],
				["transactions", []],
			]),
		);
	});

	it("gives a null name for an id whose row is gone", async () => {
		const { service } = listing([RECEIPT], {
			memberNames: new Map(),
			descriptions: new Map(),
		});

		await expect(service.list({})).resolves.toEqual([
			expect.objectContaining({ userName: null, transactionDescription: null }),
		]);
	});
});

describe("get", () => {
	function getting(
		receipt: Receipt | undefined,
		items: ReceiptItem[],
		staged: Pick<Staged, "projectId"> = {},
	) {
		const asked: unknown[][] = [];
		const service = serviceWith({
			...staged,
			repository: {
				findById: async () => receipt,
				findItems: async () => items,
			},
			transactions: {
				descriptionsByIds: async (ids) => {
					asked.push(["transactions", ids]);
					return new Map([[3, "COLES 123"]]);
				},
			},
			expenses: {
				namesByIds: async (ids) => {
					asked.push(["expenses", ids]);
					return new Map([[7, { name: "Weekly shop", categoryId: 3 }]]);
				},
			},
			categories: {
				namesByIds: async (ids) => {
					asked.push(["categories", ids]);
					return new Map([[4, "Dairy"]]);
				},
			},
		});
		return { service, asked };
	}

	it("returns the receipt with its names, items and trace link", async () => {
		const { service, asked } = getting(RECEIPT, [ITEM]);

		await expect(service.get(42)).resolves.toEqual({
			...RECEIPT,
			transactionDescription: "COLES 123",
			traceUrl: "https://us.posthog.com/project/123/tracing?trace=trace-abc",
			items: [{ ...ITEM, expenseName: "Weekly shop", categoryName: "Dairy" }],
		});
		expect(asked).toEqual(
			expect.arrayContaining([
				["transactions", [3]],
				["expenses", [7]],
				["categories", [4]],
			]),
		);
		expect(asked).toHaveLength(3);
	});

	// An item's own Category, not its Expense's: the two are picked apart.
	it("names each item by its own links, null when unlinked", async () => {
		const { service, asked } = getting({ ...RECEIPT, transactionId: null }, [
			{ ...ITEM, expenseId: null, categoryId: null },
		]);

		const receipt = await service.get(42);

		expect(receipt.transactionDescription).toBeNull();
		expect(receipt.items).toEqual([
			{
				...ITEM,
				expenseId: null,
				categoryId: null,
				expenseName: null,
				categoryName: null,
			},
		]);
		expect(asked).toEqual(
			expect.arrayContaining([
				["transactions", []],
				["expenses", []],
				["categories", []],
			]),
		);
	});

	it("gives no trace link with no PostHog project", async () => {
		const { service } = getting(RECEIPT, [], { projectId: undefined });

		await expect(service.get(42)).resolves.toMatchObject({ traceUrl: null });
	});

	it("throws NotFoundError for a missing id", async () => {
		const { service } = getting(undefined, []);

		const thrown = await service.get(42).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt not found." });
	});
});

describe("retry", () => {
	it("requeues the failed row under the ambient trace", async () => {
		const { method, calls } = recorder(RECEIPT);
		const service = serviceWith({ repository: { requeueFailed: method } });

		const { traceId, result } = inSpan(() => service.retry(42));

		await expect(result).resolves.toBe(RECEIPT);
		expect(calls).toEqual([[42, traceId]]);
	});

	it("throws NotFoundError when no failed row matches", async () => {
		const service = serviceWith({
			repository: { requeueFailed: async () => undefined },
		});

		const thrown = await service.retry(42).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({
			message: "Receipt not found or not in a failed state.",
		});
	});
});

describe("delete", () => {
	it("deletes the row, then its file", async () => {
		const deletions = recorder({ blobPathname: "receipt-abc.jpg" });
		const files = recorder(undefined);
		const service = serviceWith({
			repository: { deleteUnlessDuplicated: deletions.method },
			blobStore: { delete: files.method },
		});

		await expect(service.delete(42)).resolves.toBeUndefined();
		expect(deletions.calls).toEqual([[42]]);
		expect(files.calls).toEqual([["receipt-abc.jpg"]]);
	});

	it("still succeeds when the file delete fails", async () => {
		const service = serviceWith({
			repository: {
				deleteUnlessDuplicated: async () => ({ blobPathname: "x.jpg" }),
			},
			blobStore: { delete: throwing(new Error("store down")) },
		});

		await expect(service.delete(42)).resolves.toBeUndefined();
	});

	it.each([
		["missing", NotFoundError, "Receipt not found."],
		[
			"has-duplicates",
			ConflictError,
			"Delete the duplicate copies of this receipt first.",
		],
	] as const)(
		"leaves the file alone when the row is %s",
		async (outcome, ErrorType, message) => {
			const files = recorder(undefined);
			const service = serviceWith({
				repository: { deleteUnlessDuplicated: async () => outcome },
				blobStore: { delete: files.method },
			});

			const thrown = await service.delete(42).catch((e: unknown) => e);

			expect(thrown).toBeInstanceOf(ErrorType);
			expect(thrown).toMatchObject({ message });
			expect(files.calls).toEqual([]);
		},
	);
});

describe("matchCandidates", () => {
	const ROWS = [
		{
			id: 1,
			description: "COLES 123",
			amount: 42.5,
			date: new Date("2026-09-10T02:00:00.000Z"),
		},
		{
			id: 2,
			description: "COLES 456",
			amount: 42.5,
			date: new Date("2026-09-10T03:00:00.000Z"),
		},
	];

	it("ranks the window's rows, dropping those another receipt claims", async () => {
		const windows = recorder(ROWS);
		const probes = recorder([2]);
		const service = serviceWith({
			repository: {
				findMatchInput: async () => ({
					total: 42.5,
					receiptDate: "2026-09-10",
				}),
				findMatchedTransactionIds: probes.method,
			},
			transactions: { inDateWindow: windows.method },
		});

		const candidates = await service.matchCandidates(42, "Australia/Sydney");

		expect(candidates.map(({ id, hasReceipt }) => [id, hasReceipt])).toEqual([
			[1, false],
		]);
		expect(windows.calls).toEqual([[matchScanWindow("2026-09-10")]]);
		expect(probes.calls).toEqual([[[1, 2]]]);
	});

	it.each([
		["total", { total: null, receiptDate: "2026-09-10" }],
		["receipt date", { total: 42.5, receiptDate: null }],
	])("skips the scan with no %s", async (_, input) => {
		const service = serviceWith({
			repository: { findMatchInput: async () => input },
		});

		await expect(service.matchCandidates(42, "UTC")).resolves.toEqual([]);
	});

	it("throws NotFoundError for a missing id", async () => {
		const service = serviceWith({
			repository: { findMatchInput: async () => undefined },
		});

		const thrown = await service
			.matchCandidates(42, "UTC")
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt not found." });
	});
});

describe("confirmMatch", () => {
	it("links the receipt to the transaction", async () => {
		const { method, calls } = recorder(RECEIPT);
		const service = serviceWith({ repository: { setTransaction: method } });

		await expect(service.confirmMatch(42, 3)).resolves.toBe(RECEIPT);
		expect(calls).toEqual([[42, 3]]);
	});

	it.each([
		["23505", "That transaction already has a receipt."],
		["23503", "That transaction no longer exists."],
	])("turns violation %s into a ConflictError", async (code, message) => {
		const error = failedQuery(code);
		const service = serviceWith({
			repository: { setTransaction: throwing(error) },
		});

		const thrown = await service.confirmMatch(42, 3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message, cause: error });
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23514");
		const service = serviceWith({
			repository: { setTransaction: throwing(error) },
		});

		await expect(service.confirmMatch(42, 3)).rejects.toBe(error);
	});

	it("throws NotFoundError for a missing id", async () => {
		const service = serviceWith({
			repository: { setTransaction: async () => undefined },
		});

		const thrown = await service.confirmMatch(42, 3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt not found." });
	});
});

describe.each([
	["setItemExpense", "expenseId"],
	["setItemCategory", "categoryId"],
] as const)("%s", (method, column) => {
	it("links the item and returns it", async () => {
		const linked = { ...ITEM, [column]: 9 };
		const write = recorder(linked);
		const service = serviceWith({ repository: { [method]: write.method } });

		await expect(service[method](5, 9)).resolves.toBe(linked);
		expect(write.calls).toEqual([[5, 9]]);
	});

	it("turns a foreign-key violation into a ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({
			repository: { [method]: throwing(error) },
		});

		const thrown = await service[method](5, 9).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: ITEM_FK_CONFLICT_MESSAGE,
			cause: error,
		});
	});

	it("throws NotFoundError for a missing item", async () => {
		const service = serviceWith({
			repository: { [method]: async () => undefined },
		});

		const thrown = await service[method](5, null).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt item not found." });
	});
});
