import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	matchScanWindow,
	RECEIPT_FILE_TYPES,
	type Receipt,
	type ReceiptItem,
} from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { MembersService } from "~/server/auth/members.service";
import type { BlobStore } from "~/server/blob-store/blob-store";
import type { ClientUploads } from "~/server/blob-store/client-uploads";
import type { CategoriesService } from "~/server/categories/categories.service";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
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
import {
	ReceiptsService,
	type StoredBlob,
	UploadUnauthorizedError,
} from "./receipts.service";

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
	blobStore?: Partial<Pick<BlobStore, "delete" | "stream">>;
	uploads?: Partial<ClientUploads>;
	projectId?: string;
}

const UPLOAD_PREFIX = "local/b/receipts/upload/";

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
		blobStore: { delete: unstaged, stream: unstaged, ...staged.blobStore },
		uploads: { answer: unstaged, ...staged.uploads },
		uploadPathPrefix: UPLOAD_PREFIX,
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
	blobUrl: `https://blob.vercel-storage.com/${UPLOAD_PREFIX}receipt-abc.jpg`,
	blobPathname: `${UPLOAD_PREFIX}receipt-abc.jpg`,
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

	// Deleting a row frees its file, so a row pointing at another Receipt's file
	// (an email one, or another branch's) would delete that file with it.
	it.each(["receipts/email/a.pdf", "local/other/receipts/upload/a.jpg"])(
		"refuses a file outside the upload prefix (%j) and inserts nothing",
		async (blobPathname) => {
			const { method, calls } = recorder([RECEIPT]);
			const service = serviceWith({ repository: { insertPending: method } });

			await expect(
				service.create("member-1", { ...UPLOAD, blobPathname }),
			).rejects.toThrow(InvalidInputError);
			expect(calls).toEqual([]);
		},
	);
});

describe("createFromEmail", () => {
	const BLOBS: StoredBlob[] = [
		{
			blobUrl: "https://blob.test/receipts/email/a.pdf",
			blobPathname: "receipts/email/a.pdf",
			contentType: "application/pdf",
		},
		{
			blobUrl: "https://blob.test/receipts/email/b.png",
			blobPathname: "receipts/email/b.png",
			contentType: "image/png",
		},
	];

	// The worker continues this trace (adr016), so each row must store the live one.
	it("mints one pending email row per blob, firing receipt/email.received, and returns the ids in order", async () => {
		const { method, calls } = recorder([
			{ ...RECEIPT, id: 11 },
			{ ...RECEIPT, id: 12 },
		]);
		const service = serviceWith({ repository: { insertPending: method } });

		const { traceId, result } = inSpan(() =>
			service.createFromEmail("member-1", BLOBS),
		);

		await expect(result).resolves.toEqual([11, 12]);
		expect(calls).toEqual([
			[
				BLOBS.map((blob) => ({
					userId: "member-1",
					channel: ReceiptChannel.Email,
					...blob,
					traceId,
				})),
				"receipt/email.received",
			],
		]);
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

describe("openImage", () => {
	const stream = new Blob([new Uint8Array([1])]).stream();

	it("streams the blob the row points at, under its stored type", async () => {
		const pathnames = recorder("receipts/r.png");
		const streams = recorder({ stream, contentType: "image/png" });
		const service = serviceWith({
			repository: { findBlobPathname: pathnames.method },
			blobStore: { stream: streams.method },
		});

		await expect(service.openImage(42)).resolves.toEqual({
			stream,
			contentType: "image/png",
		});
		expect(pathnames.calls).toEqual([[42]]);
		expect(streams.calls).toEqual([["receipts/r.png"]]);
	});

	it("404s a missing row without opening the store", async () => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => undefined },
		});

		const thrown = await service.openImage(42).catch((error) => error);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt not found." });
	});

	it("404s a blob the store no longer has", async () => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => "receipts/r.png" },
			blobStore: { stream: async () => null },
		});

		const thrown = await service.openImage(42).catch((error) => error);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt image not found." });
	});

	// A member sets the blob's type at upload, so `text/html` would otherwise stream
	// back same-origin as executable markup.
	it.each([
		["image/jpeg", "image/jpeg"],
		["image/png", "image/png"],
		["application/pdf", "application/pdf"],
		["text/html", "application/octet-stream"],
		["image/svg+xml", "application/octet-stream"],
	])("serves %s as %s", async (stored, served) => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => "receipts/r.png" },
			blobStore: { stream: async () => ({ stream, contentType: stored }) },
		});

		await expect(service.openImage(42)).resolves.toEqual({
			stream,
			contentType: served,
		});
	});
});

describe("openHtml", () => {
	const stream = new Blob([new Uint8Array([1])]).stream();

	it("streams the blob the row points at", async () => {
		const pathnames = recorder("receipts/r.html");
		const streams = recorder({ stream, contentType: "text/html" });
		const service = serviceWith({
			repository: { findBlobPathname: pathnames.method },
			blobStore: { stream: streams.method },
		});

		await expect(service.openHtml(42)).resolves.toEqual({
			stream,
			contentType: "text/html; charset=utf-8",
		});
		expect(pathnames.calls).toEqual([[42]]);
		expect(streams.calls).toEqual([["receipts/r.html"]]);
	});

	// The email pipeline writes bodies as JS strings, which Blob stores as UTF-8.
	it.each([
		["text/html", "text/html; charset=utf-8"],
		["text/plain", "text/plain; charset=utf-8"],
		["text/html; charset=ISO-8859-1", "text/html; charset=utf-8"],
	])("serves %s as %s", async (stored, served) => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => "receipts/r.html" },
			blobStore: { stream: async () => ({ stream, contentType: stored }) },
		});

		await expect(service.openHtml(42)).resolves.toEqual({
			stream,
			contentType: served,
		});
	});

	it("404s a missing row without opening the store", async () => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => undefined },
		});

		const thrown = await service.openHtml(42).catch((error) => error);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt not found." });
	});

	it("404s a blob the store no longer has", async () => {
		const service = serviceWith({
			repository: { findBlobPathname: async () => "receipts/r.html" },
			blobStore: { stream: async () => null },
		});

		const thrown = await service.openHtml(42).catch((error) => error);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt body not found." });
	});

	// Only e-receipt bodies leave through the sandboxed route (adr019).
	it.each([
		"image/png",
		"application/pdf",
		"image/svg+xml",
		"application/octet-stream",
	])("404s a %s blob and cancels its stream", async (stored) => {
		let cancelled = false;
		const unread = new ReadableStream<Uint8Array>({
			cancel: () => {
				cancelled = true;
			},
		});
		const service = serviceWith({
			repository: { findBlobPathname: async () => "receipts/r.png" },
			blobStore: {
				stream: async () => ({ stream: unread, contentType: stored }),
			},
		});

		const thrown = await service.openHtml(42).catch((error) => error);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Receipt body not found." });
		expect(cancelled).toBe(true);
	});
});

describe("answerUpload", () => {
	const event = {
		type: "blob.generate-client-token",
		payload: {
			pathname: `${UPLOAD_PREFIX}a.jpg`,
			callbackUrl: "https://ledger.test/api/receipts/upload",
			clientPayload: null,
			multipart: false,
		},
	} as const;
	const request = new Request("https://ledger.test/api/receipts/upload");

	// The fake runs the grant the way Blob does, so the policy is observable.
	const grantRunner =
		(
			answered: unknown[],
			pathname = `${UPLOAD_PREFIX}a.jpg`,
		): ClientUploads["answer"] =>
		async (_request, _event, grant) => {
			answered.push(await grant(pathname));
			return { type: "blob.generate-client-token", clientToken: "tok" };
		};

	it("hands Blob the request and event, and returns its answer", async () => {
		const seen: unknown[][] = [];
		const service = serviceWith({
			uploads: {
				answer: async (...args) => {
					seen.push(args);
					return "answer";
				},
			},
		});

		await expect(
			service.answerUpload(request, event, "member-1"),
		).resolves.toBe("answer");
		expect(seen[0]?.slice(0, 2)).toEqual([request, event]);
	});

	it("grants the receipt upload policy to a signed-in member", async () => {
		const grants: unknown[] = [];
		const service = serviceWith({ uploads: { answer: grantRunner(grants) } });

		await service.answerUpload(request, event, "member-1");

		expect(grants).toEqual([
			{
				allowedContentTypes: [...RECEIPT_FILE_TYPES],
				maximumSizeInBytes: 10 * 1024 * 1024,
				addRandomSuffix: true,
				tokenPayload: JSON.stringify({ userId: "member-1" }),
			},
		]);
	});

	// Signed-out must stay a 401 whatever the path, so the member check comes first.
	it("refuses the grant when nobody is signed in, before checking the path", async () => {
		const service = serviceWith({
			uploads: { answer: grantRunner([], "receipts/a.jpg") },
		});

		await expect(
			service.answerUpload(request, event, undefined),
		).rejects.toThrow(UploadUnauthorizedError);
	});

	it("refuses a token for a path outside the upload prefix", async () => {
		const grants: unknown[] = [];
		const service = serviceWith({
			uploads: { answer: grantRunner(grants, "receipts/email/a.pdf") },
		});

		await expect(
			service.answerUpload(request, event, "member-1"),
		).rejects.toThrow(InvalidInputError);
		expect(grants).toEqual([]);
	});
});
