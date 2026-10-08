import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import {
	DrizzleReceiptExtractionRepository,
	type ReceiptRow,
} from "./receipt-extraction.repository";
import { receiptItems, receipts } from "./receipts.schema";

const dialect = new PgDialect();
const render = (cond: unknown) =>
	// biome-ignore lint/suspicious/noExplicitAny: dialect renders a drizzle SQL condition to text.
	dialect.sqlToQuery(cond as any).sql;

// Chain-capturing fake db (mirrors outbox.repository.test.ts): selects resolve to the
// staged rows and capture their WHERE; every `set()`/`values()` write is recorded.
function harness({ rows = [] }: { rows?: unknown[] } = {}) {
	let selectWhere: unknown;
	let transactions = 0;
	const updates: {
		table: unknown;
		set: Record<string, unknown>;
		where: unknown;
	}[] = [];
	const inserts: { table: unknown; values: unknown }[] = [];

	const mkUpdate = (table: unknown) => ({
		set: (vals: Record<string, unknown>) => ({
			where: (cond: unknown) => {
				updates.push({ table, set: vals, where: cond });
				return Promise.resolve();
			},
		}),
	});

	const db = {
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					selectWhere = cond;
					return Promise.resolve(rows);
				},
			}),
		}),
		update: mkUpdate,
		transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
			transactions += 1;
			return cb({
				update: mkUpdate,
				insert: (table: unknown) => ({
					values: (vals: unknown) => {
						inserts.push({ table, values: vals });
						return Promise.resolve();
					},
				}),
			});
		},
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		repository: new DrizzleReceiptExtractionRepository({ db: db as any }),
		updates,
		inserts,
		getSelectWhere: () => selectWhere,
		transactions: () => transactions,
	};
}

const receipt: ReceiptRow = {
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
	traceId: null,
	transactionId: null,
	duplicateOfId: null,
	createdAt: new Date(),
	updatedAt: null,
};

describe("DrizzleReceiptExtractionRepository", () => {
	describe("findById", () => {
		it("returns the one row by id, or undefined", async () => {
			const h = harness({ rows: [receipt] });

			await expect(h.repository.findById(1)).resolves.toBe(receipt);
			expect(render(h.getSelectWhere())).toContain('"id" =');

			await expect(harness().repository.findById(1)).resolves.toBeUndefined();
		});
	});

	describe("setContentHash", () => {
		it("writes only contentHash", async () => {
			const h = harness();

			await h.repository.setContentHash(1, "hash-abc");

			expect(h.updates).toHaveLength(1);
			expect(h.updates[0]?.table).toBe(receipts);
			expect(h.updates[0]?.set).toEqual({ contentHash: "hash-abc" });
			expect(render(h.updates[0]?.where)).toContain('"id" =');
		});
	});

	describe("findProcessedByHash", () => {
		it("matches on hash, excludes the receipt itself, and only a processed row", async () => {
			const h = harness({ rows: [{ id: 42 }] });

			await expect(
				h.repository.findProcessedByHash("hash-abc", 1),
			).resolves.toEqual({ id: 42 });

			const where = render(h.getSelectWhere());
			expect(where).toContain("contentHash");
			expect(where).toContain("<>");
			expect(where).toContain("status");
		});
	});

	describe("markDuplicate", () => {
		it("sets status duplicate pointing at the original", async () => {
			const h = harness();

			await h.repository.markDuplicate(1, 42);

			expect(h.updates[0]?.set).toEqual({
				status: ReceiptStatus.Duplicate,
				duplicateOfId: 42,
			});
		});
	});

	describe("saveExtraction", () => {
		const values = {
			vendor: "Corner Grocer",
			receiptDate: "2026-08-14",
			total: 8.99,
			currency: "USD",
			rawJson: { vendor: "Corner Grocer" },
		};

		it("marks processed and inserts the items with receiptId, in one transaction", async () => {
			const h = harness();

			await h.repository.saveExtraction(1, values, [
				{ name: "Milk", price: 3.99, quantity: 1, categoryId: 7 },
				{ name: "Bread", price: 2.5, quantity: 2, categoryId: null },
			]);

			expect(h.transactions()).toBe(1);
			expect(h.updates[0]?.set).toEqual({
				status: ReceiptStatus.Processed,
				...values,
			});
			expect(h.inserts).toHaveLength(1);
			expect(h.inserts[0]?.table).toBe(receiptItems);
			expect(h.inserts[0]?.values).toEqual([
				{
					receiptId: 1,
					name: "Milk",
					price: 3.99,
					quantity: 1,
					categoryId: 7,
				},
				{
					receiptId: 1,
					name: "Bread",
					price: 2.5,
					quantity: 2,
					categoryId: null,
				},
			]);
		});

		it("skips the item insert when there are none", async () => {
			const h = harness();

			await h.repository.saveExtraction(1, values, []);

			expect(h.updates).toHaveLength(1);
			expect(h.inserts).toHaveLength(0);
		});
	});

	describe("markFailed", () => {
		it("sets status failed with the reason", async () => {
			const h = harness();

			await h.repository.markFailed(1, "Retry in a moment.");

			expect(h.updates[0]?.set).toEqual({
				status: ReceiptStatus.Failed,
				error: "Retry in a moment.",
			});
		});
	});
});
