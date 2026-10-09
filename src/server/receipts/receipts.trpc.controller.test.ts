import { describe, expect, it } from "vitest";
import type { Receipt, ReceiptItem } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { recorder } from "~/test/fakes";
import type { ReceiptsService } from "./receipts.service";
import { receiptRouter } from "./receipts.trpc.controller";

const router = createTRPCRouter({ receipt: receiptRouter });

function callerWith(receipts: Partial<ReceiptsService>, session?: null) {
	return createTestCaller(router, { services: { receipts }, session });
}

const RECEIPT: Receipt = {
	id: 42,
	status: ReceiptStatus.Pending,
	channel: ReceiptChannel.Upload,
	userId: "member-1",
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: null,
	receiptDate: null,
	total: null,
	currency: null,
	rawJson: null,
	error: null,
	traceId: null,
	transactionId: null,
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
	categoryId: null,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
};

const UPLOAD = {
	blobUrl: RECEIPT.blobUrl,
	blobPathname: RECEIPT.blobPathname,
	contentType: "image/jpeg",
};

describe("receipt router", () => {
	it("create hands the service the session member and the parsed input", async () => {
		const { method, calls } = recorder(RECEIPT);

		await expect(
			callerWith({ create: method }).receipt.create(UPLOAD),
		).resolves.toEqual(RECEIPT);
		expect(calls).toEqual([["member-1", UPLOAD]]);
	});

	it("create drops an owner sent in the input", async () => {
		const { method, calls } = recorder(RECEIPT);
		const forged = { ...UPLOAD, userId: "member-2" };

		await callerWith({ create: method }).receipt.create(forged);

		expect(calls).toEqual([["member-1", UPLOAD]]);
	});

	it("list hands the service the filter", async () => {
		const { method, calls } = recorder([]);
		const filter = { status: ReceiptStatus.Failed, unmatchedOnly: true };

		await expect(
			callerWith({ list: method }).receipt.list(filter),
		).resolves.toEqual([]);
		expect(calls).toEqual([[filter]]);
	});

	it("list hands the service an empty filter when none is sent", async () => {
		const { method, calls } = recorder([]);

		await callerWith({ list: method }).receipt.list();

		expect(calls).toEqual([[{}]]);
	});

	it.each([
		["get", RECEIPT],
		["retry", RECEIPT],
	] as const)("%s hands the service the id", async (procedure, result) => {
		const { method, calls } = recorder(result);

		await expect(
			callerWith({ [procedure]: method }).receipt[procedure]({ id: 42 }),
		).resolves.toEqual(result);
		expect(calls).toEqual([[42]]);
	});

	it("delete deletes by id and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }).receipt.delete({ id: 42 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[42]]);
	});

	it("matchCandidates hands the service the receipt and the viewer's zone", async () => {
		const { method, calls } = recorder([]);

		await expect(
			callerWith({ matchCandidates: method }).receipt.matchCandidates({
				receiptId: 42,
				timeZone: "Australia/Sydney",
			}),
		).resolves.toEqual([]);
		expect(calls).toEqual([[42, "Australia/Sydney"]]);
	});

	it("confirmMatch hands the service the receipt and transaction", async () => {
		const { method, calls } = recorder(RECEIPT);

		await expect(
			callerWith({ confirmMatch: method }).receipt.confirmMatch({
				receiptId: 42,
				transactionId: 3,
			}),
		).resolves.toEqual(RECEIPT);
		expect(calls).toEqual([[42, 3]]);
	});

	it("setItemExpense hands the service the item and Expense", async () => {
		const { method, calls } = recorder(ITEM);

		await expect(
			callerWith({ setItemExpense: method }).receipt.setItemExpense({
				itemId: 5,
				expenseId: 7,
			}),
		).resolves.toEqual(ITEM);
		expect(calls).toEqual([[5, 7]]);
	});

	it("setItemCategory hands the service the item and Category", async () => {
		const { method, calls } = recorder(ITEM);

		await expect(
			callerWith({ setItemCategory: method }).receipt.setItemCategory({
				itemId: 5,
				categoryId: null,
			}),
		).resolves.toEqual(ITEM);
		expect(calls).toEqual([[5, null]]);
	});

	// A decimal id used to reach Postgres and 500.
	it.each(["get", "retry", "delete"] as const)(
		"%s rejects a decimal id before reaching the service",
		async (procedure) => {
			const { method, calls } = recorder(RECEIPT);

			await expect(
				callerWith({ [procedure]: method }).receipt[procedure]({ id: 1.5 }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(calls).toEqual([]);
		},
	);

	it("surfaces a NotFoundError as NOT_FOUND", async () => {
		const get = async (): Promise<never> => {
			throw new NotFoundError("Receipt not found.");
		};

		await expect(
			callerWith({ get }).receipt.get({ id: 42 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found.",
		});
	});

	it("surfaces a ConflictError as CONFLICT", async () => {
		const confirmMatch = async (): Promise<never> => {
			throw new ConflictError("That transaction already has a receipt.");
		};

		await expect(
			callerWith({ confirmMatch }).receipt.confirmMatch({
				receiptId: 42,
				transactionId: 3,
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That transaction already has a receipt.",
		});
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder([]);

		await expect(
			callerWith({ list: method }, null).receipt.list(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
