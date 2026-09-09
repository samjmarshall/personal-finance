import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import type {
	OutboxEvents,
	OutboxWrites,
} from "~/server/outbox/outbox.repository";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { receipts } from "~/server/receipts/receipts.schema";
import { DrizzleEmailRepository } from "./email.repository";

const dialect = new PgDialect();
const render = (cond: unknown) =>
	// biome-ignore lint/suspicious/noExplicitAny: dialect renders a drizzle SQL condition to text.
	dialect.sqlToQuery(cond as any).sql;

// Chain-capturing fake db for the allowlist read, plus a fake write door that runs
// the writes against a fake tx and keeps the events they derived — so a test sees
// both the rows minted and the events that rode the same commit.
function harness({ senders = [] }: { senders?: { userId: string }[] } = {}) {
	let selectWhere: unknown;
	let limitArg: number | undefined;
	let commits = 0;
	let emitted: OutboxEventDescriptor[] = [];
	const inserts: { table: unknown; rows: Record<string, unknown>[] }[] = [];

	const tx = {
		insert: (table: unknown) => ({
			values: (rows: Record<string, unknown>[]) => {
				inserts.push({ table, rows });
				return {
					returning: async () => rows.map((_, i) => ({ id: i + 1 })),
				};
			},
		}),
	};

	const db = {
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					selectWhere = cond;
					return {
						limit: (n: number) => {
							limitArg = n;
							return Promise.resolve(senders);
						},
					};
				},
			}),
		}),
	};

	const outbox: OutboxWriteDoor = {
		commit: async <T>(writes: OutboxWrites<T>, events: OutboxEvents<T>) => {
			commits += 1;
			const result = await writes(tx as never);
			emitted = events(result);
			return result;
		},
		publish: async () => {},
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		repository: new DrizzleEmailRepository({ db: db as any, outbox }),
		inserts,
		emitted: () => emitted,
		commits: () => commits,
		getSelectWhere: () => selectWhere,
		getLimit: () => limitArg,
	};
}

describe("DrizzleEmailRepository", () => {
	describe("findAllowedSender", () => {
		it("returns the owner of a listed address, looking up by email with limit 1", async () => {
			const h = harness({ senders: [{ userId: "u1" }] });

			await expect(
				h.repository.findAllowedSender("sam@example.com"),
			).resolves.toEqual({ userId: "u1" });
			expect(render(h.getSelectWhere())).toContain('"email" =');
			expect(h.getLimit()).toBe(1);
		});

		it("returns undefined for an unlisted address", async () => {
			const h = harness();

			await expect(
				h.repository.findAllowedSender("nobody@example.com"),
			).resolves.toBeUndefined();
		});
	});

	describe("createPendingReceipts", () => {
		const blobs = [
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

		it("mints one pending email-channel row per blob, returning ids in order", async () => {
			const h = harness();

			await expect(
				h.repository.createPendingReceipts("u1", blobs),
			).resolves.toEqual([1, 2]);

			expect(h.inserts).toHaveLength(1);
			expect(h.inserts[0]?.table).toBe(receipts);
			expect(h.inserts[0]?.rows).toEqual([
				{
					userId: "u1",
					status: ReceiptStatus.Pending,
					channel: ReceiptChannel.Email,
					...blobs[0],
				},
				{
					userId: "u1",
					status: ReceiptStatus.Pending,
					channel: ReceiptChannel.Email,
					...blobs[1],
				},
			]);
		});

		// The frozen payload carries only a receiptId, so the row must exist before the
		// event fires — the event is derived from the write's result inside one commit.
		it("rides exactly one receipt/email.received per row on the same commit", async () => {
			const h = harness();

			await h.repository.createPendingReceipts("u1", blobs);

			expect(h.commits()).toBe(1);
			expect(h.emitted()).toEqual([
				expect.objectContaining({
					name: "receipt/email.received",
					data: { receiptId: 1 },
				}),
				expect.objectContaining({
					name: "receipt/email.received",
					data: { receiptId: 2 },
				}),
			]);
		});
	});
});
