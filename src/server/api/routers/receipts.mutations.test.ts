import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReceiptStatus } from "~/lib/constants";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

// The write door is exercised in outbox/outbox.service.test.ts; here we only assert what
// retry hands it (the conditional update + the derived receipt/retry event).
const { commitWithOutbox } = vi.hoisted(() => ({ commitWithOutbox: vi.fn() }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox }));

// del is the only external I/O in delete; assert it's called with the stored pathname.
const { del } = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del }));

// currentTraceId reads the ambient OTel span; stub it so retry's trace-id overwrite
// is asserted directly rather than depending on a registered provider.
const { currentTraceId } = vi.hoisted(() => ({ currentTraceId: vi.fn() }));
vi.mock("~/server/observability/current-trace-id", () => ({ currentTraceId }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

function caller(db: unknown) {
	return createCallerFactory(receiptRouter)({
		db,
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);
}

// Fake tx whose update().set().where().returning() yields the given rows — [] when
// the conditional (id AND status=failed) matches nothing. Captures the set() payload
// so a test can assert what the update wrote.
// biome-ignore lint/suspicious/noExplicitAny: hand-rolled tx stands in for drizzle.
function updateTx(returning: any[], capture?: (values: any) => void) {
	return {
		update: () => ({
			// biome-ignore lint/suspicious/noExplicitAny: values are the row under test.
			set: (values: any) => {
				capture?.(values);
				return { where: () => ({ returning: async () => returning }) };
			},
		}),
	};
}

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	commitWithOutbox.mockReset();
	del.mockReset();
	currentTraceId.mockReset().mockReturnValue("trace-retry");
});
afterEach(() => vi.restoreAllMocks());

describe("receipt.retry", () => {
	it("flips a failed receipt to pending, overwrites the trace id, and mints one receipt/retry event", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: captured derived events.
		let outboxEvents: any;
		// biome-ignore lint/suspicious/noExplicitAny: captured set() payload.
		let setValues: any;
		commitWithOutbox.mockImplementation(async (writes, events) => {
			const row = await writes(updateTx([{ id: 9 }], (v) => (setValues = v)));
			outboxEvents = events(row);
			return row;
		});

		await caller({}).retry({ id: 9 });

		expect(setValues).toEqual({
			status: ReceiptStatus.Pending,
			traceId: "trace-retry",
		});
		expect(outboxEvents).toHaveLength(1);
		expect(outboxEvents[0].name).toBe("receipt/retry");
		expect(outboxEvents[0].data).toEqual({
			receiptId: 9,
			_trace: expect.any(Object),
		});
		expect(typeof outboxEvents[0].data.receiptId).toBe("number");
	});

	it("refuses a non-failed receipt (conditional update matches nothing) and mints nothing", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: captured derived events.
		let outboxEvents: any;
		commitWithOutbox.mockImplementation(async (writes, events) => {
			const row = await writes(updateTx([]));
			outboxEvents = events(row);
			return row;
		});

		await expect(caller({}).retry({ id: 9 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(outboxEvents).toBeUndefined();
	});
});

// delete runs two selects — the blobPathname lookup, then the duplicate-copy probe.
// select() consumes one queued batch per call; .where() yields an awaitable that also
// chains .limit, so both `await …where()` and `await …where().limit(1)` resolve.
function selectQueue(...batches: unknown[][]) {
	let i = 0;
	return () => {
		const rows = batches[i++] ?? [];
		const result = Object.assign(Promise.resolve(rows), {
			limit: () => Promise.resolve(rows),
		});
		return { from: () => ({ where: () => result }) };
	};
}

describe("receipt.delete", () => {
	it("removes the row then best-effort deletes the stored blob pathname", async () => {
		let deletedId: number | undefined;
		const db = {
			select: selectQueue([{ blobPathname: "receipt-abc.jpg" }], []),
			delete: () => ({
				where: async (clause: unknown) => {
					// eq(receipts.id, 3) — presence is enough; assert delete ran.
					deletedId = 3;
					void clause;
				},
			}),
		};

		const result = await caller(db).delete({ id: 3 });

		expect(deletedId).toBe(3);
		expect(del).toHaveBeenCalledWith("receipt-abc.jpg");
		expect(result).toEqual({ success: true });
	});

	it("swallows a blob del failure — the row delete already committed", async () => {
		del.mockRejectedValueOnce(new Error("blob gone"));
		const db = {
			select: selectQueue([{ blobPathname: "x.jpg" }], []),
			delete: () => ({ where: async () => {} }),
		};

		await expect(caller(db).delete({ id: 1 })).resolves.toEqual({
			success: true,
		});
	});

	it("blocks with CONFLICT (row kept) when duplicate copies still reference it", async () => {
		let deleted = false;
		const db = {
			select: selectQueue([{ blobPathname: "x.jpg" }], [{ id: 99 }]),
			delete: () => ({
				where: async () => {
					deleted = true;
				},
			}),
		};

		await expect(caller(db).delete({ id: 5 })).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(deleted).toBe(false);
		expect(del).not.toHaveBeenCalled();
	});

	it("404s when the receipt is gone", async () => {
		const db = { select: selectQueue([]) };

		await expect(caller(db).delete({ id: 404 })).rejects.toBeInstanceOf(
			TRPCError,
		);
		expect(del).not.toHaveBeenCalled();
	});
});
