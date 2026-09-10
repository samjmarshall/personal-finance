import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure producer unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

// The injected fake: the real write door is exercised in outbox/outbox.service.test.ts;
// here we only assert what the producer hands it (the writes + the derived events).
const { commitWithOutbox } = vi.hoisted(() => ({ commitWithOutbox: vi.fn() }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

// Minimal fake ctx for a protected caller — cast past the full context type.
const caller = () =>
	createCallerFactory(receiptRouter)({
		db: {},
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);

const input = {
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
};

// Fake tx whose insert().values(v).returning() echoes v back with a given id.
// biome-ignore lint/suspicious/noExplicitAny: hand-rolled tx stands in for drizzle.
function txReturning(id: number, capture: (values: any) => void) {
	return {
		insert: () => ({
			// biome-ignore lint/suspicious/noExplicitAny: values are the row under test.
			values: (values: any) => {
				capture(values);
				return { returning: async () => [{ id, ...values }] };
			},
		}),
	};
}

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	commitWithOutbox.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("receipt.create producer", () => {
	it("inserts one pending upload receipt owned by the session user", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: captured row values.
		let inserted: any;
		commitWithOutbox.mockImplementation(async (writes) =>
			writes(txReturning(42, (v) => (inserted = v))),
		);

		const receipt = await caller().create(input);

		expect(inserted).toMatchObject({
			userId: "user-1",
			status: ReceiptStatus.Pending,
			channel: ReceiptChannel.Upload,
			blobUrl: input.blobUrl,
			blobPathname: input.blobPathname,
			contentType: input.contentType,
		});
		expect(receipt.id).toBe(42);
	});

	it("mints exactly one receipt/uploaded event carrying the row id as a number", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: captured derived events.
		let outboxEvents: any;
		commitWithOutbox.mockImplementation(async (writes, events) => {
			const row = await writes(txReturning(7, () => {}));
			outboxEvents = events(row);
			return row;
		});

		await caller().create(input);

		expect(outboxEvents).toHaveLength(1);
		expect(outboxEvents[0].name).toBe("receipt/uploaded");
		expect(outboxEvents[0].data).toEqual({ receiptId: 7 });
		// buildOutboxEvent parses against the registry (number); a string would throw.
		expect(typeof outboxEvents[0].data.receiptId).toBe("number");
	});
});
