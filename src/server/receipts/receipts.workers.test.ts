import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { receiptItems, type receipts } from "~/server/receipts/receipts.schema";
import type { ReceiptExtraction } from "./extraction";
import { makeRunProcessReceipt } from "./receipts.workers";

type ReceiptRow = typeof receipts.$inferSelect;

const baseReceipt = (over: Partial<ReceiptRow> = {}): ReceiptRow => ({
	id: 1,
	status: ReceiptStatus.Pending,
	channel: ReceiptChannel.Upload,
	userId: "u1",
	blobUrl: "https://blob.example/r1.jpg",
	blobPathname: "r1.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: null,
	receiptDate: null,
	total: null,
	currency: null,
	rawJson: null,
	error: null,
	transactionId: null,
	duplicateOfId: null,
	createdAt: new Date(),
	updatedAt: null,
	...over,
});

const extraction: ReceiptExtraction = {
	vendor: "Corner Grocer",
	receiptDate: "2026-08-14",
	total: 8.99,
	currency: "USD",
	items: [
		{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
		{ name: "Bread", price: 2.5, quantity: 2, expenseCategoryId: null },
	],
};

// Chain-capturing fake db (mirrors outbox.workers.test.ts): the select/update/insert
// chains resolve to staged data and record every `set()`/`values()` write. Selects
// dispatch on the table object; the receipts table is queried twice (load, then dedup),
// so a call counter tells them apart.
function harness(opts: {
	receipt?: ReceiptRow;
	dupRows?: { id: number }[];
	categories?: { id: number; name: string }[];
}) {
	const { receipt, dupRows = [], categories = [] } = opts;
	const updates: { table: unknown; set: Record<string, unknown> }[] = [];
	const inserts: { table: unknown; values: unknown }[] = [];
	let receiptSelects = 0;

	const mkUpdate = (table: unknown) => ({
		set: (vals: Record<string, unknown>) => ({
			where: () => {
				updates.push({ table, set: vals });
				return Promise.resolve();
			},
		}),
	});

	const db = {
		select: () => ({
			// Categories are awaited straight off `.from()` (no where); receipts always
			// go through `.where()`, so the two never collide on this branch.
			from: (table: unknown) => {
				if (table === expenseCategories) return Promise.resolve(categories);
				return {
					where: () => {
						receiptSelects += 1;
						return Promise.resolve(
							receiptSelects === 1 ? (receipt ? [receipt] : []) : dupRows,
						);
					},
				};
			},
		}),
		update: mkUpdate,
		transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
			const tx = {
				update: mkUpdate,
				insert: (table: unknown) => ({
					values: (vals: unknown) => {
						inserts.push({ table, values: vals });
						return Promise.resolve();
					},
				}),
			};
			return cb(tx);
		},
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		db: db as any,
		updates,
		inserts,
	};
}

const okBlob = async () => ({
	bytes: new Uint8Array([1, 2, 3]),
	mediaType: "image/jpeg",
});

const findUpdate = (
	updates: { table: unknown; set: Record<string, unknown> }[],
	key: string,
) => updates.find((u) => key in u.set)?.set;

describe("runProcessReceipt", () => {
	it("extracts, then writes the receipt processed with its items", async () => {
		const h = harness({
			receipt: baseReceipt(),
			categories: [{ id: 7, name: "Groceries" }],
		});
		const generate = vi.fn(async () => extraction);
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate,
			hash: () => "hash-abc",
		});

		await run(1);

		expect(generate).toHaveBeenCalledOnce();
		// contentHash is persisted before the AI call (so dedup can catch a re-upload).
		expect(findUpdate(h.updates, "contentHash")?.contentHash).toBe("hash-abc");
		const processed = findUpdate(h.updates, "status");
		expect(processed?.status).toBe(ReceiptStatus.Processed);
		expect(processed?.vendor).toBe("Corner Grocer");
		expect(processed?.total).toBe(8.99);
		expect(h.inserts).toHaveLength(1);
		expect(h.inserts[0]?.table).toBe(receiptItems);
		expect(h.inserts[0]?.values).toEqual([
			{
				receiptId: 1,
				name: "Milk",
				price: 3.99,
				quantity: 1,
				expenseCategoryId: 7,
			},
			{
				receiptId: 1,
				name: "Bread",
				price: 2.5,
				quantity: 2,
				expenseCategoryId: null,
			},
		]);
	});

	it("nulls a category id the model invented instead of failing the whole extraction", async () => {
		const h = harness({
			receipt: baseReceipt(),
			categories: [{ id: 7, name: "Groceries" }],
		});
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate: async () => ({
				...extraction,
				items: [
					{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
					{ name: "Soap", price: 1.5, quantity: 1, expenseCategoryId: 99 },
				],
			}),
			hash: () => "hash-abc",
		});

		await run(1);

		expect(findUpdate(h.updates, "status")?.status).toBe(
			ReceiptStatus.Processed,
		);
		expect(h.inserts[0]?.values).toEqual([
			expect.objectContaining({ name: "Milk", expenseCategoryId: 7 }),
			expect.objectContaining({ name: "Soap", expenseCategoryId: null }),
		]);
	});

	it("nulls a non-ISO receipt date instead of failing the whole extraction", async () => {
		const h = harness({ receipt: baseReceipt(), categories: [] });
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate: async () => ({ ...extraction, receiptDate: "14/08/2026" }),
			hash: () => "hash-abc",
		});

		await run(1);

		const processed = findUpdate(h.updates, "status");
		expect(processed?.status).toBe(ReceiptStatus.Processed);
		expect(processed?.receiptDate).toBeNull();
		expect(h.inserts).toHaveLength(1);
	});

	it("marks a re-upload duplicate without spending on the AI call", async () => {
		const h = harness({
			receipt: baseReceipt(),
			dupRows: [{ id: 42 }],
		});
		const generate = vi.fn(async () => extraction);
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate,
			hash: () => "hash-abc",
		});

		await run(1);

		expect(generate).not.toHaveBeenCalled();
		const dup = findUpdate(h.updates, "duplicateOfId");
		expect(dup?.status).toBe(ReceiptStatus.Duplicate);
		expect(dup?.duplicateOfId).toBe(42);
		expect(h.inserts).toHaveLength(0);
	});

	it("returns early on an already-processed receipt (at-least-once re-delivery, no re-spend)", async () => {
		const h = harness({
			receipt: baseReceipt({ status: ReceiptStatus.Processed }),
		});
		const generate = vi.fn(async () => extraction);
		const fetchBlob = vi.fn(okBlob);
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob,
			generate,
			hash: () => "hash-abc",
		});

		await run(1);

		expect(fetchBlob).not.toHaveBeenCalled();
		expect(generate).not.toHaveBeenCalled();
		expect(h.updates).toHaveLength(0);
	});

	it("marks the receipt failed with the error text when extraction throws", async () => {
		const h = harness({
			receipt: baseReceipt(),
			categories: [],
		});
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate: async () => {
				throw new Error("model unavailable");
			},
			hash: () => "hash-abc",
		});

		await run(1);

		const failed = findUpdate(h.updates, "error");
		expect(failed?.status).toBe(ReceiptStatus.Failed);
		expect(failed?.error).toContain("model unavailable");
		expect(h.inserts).toHaveLength(0);
	});

	const overloaded = () =>
		new APICallError({
			message: "Overloaded",
			url: "https://api.anthropic.com/v1/messages",
			requestBodyValues: {},
			statusCode: 529,
			isRetryable: true,
		});

	it("rethrows a retryable API error while attempts remain so Inngest retries", async () => {
		const h = harness({ receipt: baseReceipt(), categories: [] });
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate: async () => {
				throw overloaded();
			},
			hash: () => "hash-abc",
		});

		await expect(run(1, { isFinalAttempt: false })).rejects.toThrow(
			"Overloaded",
		);

		expect(findUpdate(h.updates, "error")).toBeUndefined();
	});

	it("parks a retryable API error as failed on the final attempt", async () => {
		const h = harness({ receipt: baseReceipt(), categories: [] });
		const run = makeRunProcessReceipt({
			db: h.db,
			fetchBlob: okBlob,
			generate: async () => {
				throw overloaded();
			},
			hash: () => "hash-abc",
		});

		await run(1, { isFinalAttempt: true });

		const failed = findUpdate(h.updates, "error");
		expect(failed?.status).toBe(ReceiptStatus.Failed);
		expect(failed?.error).toContain("Overloaded");
	});
});
