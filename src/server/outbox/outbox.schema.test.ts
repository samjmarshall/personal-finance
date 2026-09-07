import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox } from "./outbox.schema";

const cols = getTableColumns(outbox);

describe("outbox table shape (adr002)", () => {
	it("makes name and data required", () => {
		expect(cols.name.notNull).toBe(true);
		expect(cols.data.notNull).toBe(true);
	});

	it("defaults createdAt and attempts so a raw INSERT need not supply them", () => {
		expect(cols.createdAt.hasDefault).toBe(true);
		expect(cols.attempts.hasDefault).toBe(true);
		expect(cols.attempts.default).toBe(0);
	});

	// processedAt is null until the send is acked; lastError only on a failed send.
	it("leaves processedAt and lastError nullable without a default", () => {
		for (const col of [cols.processedAt, cols.lastError]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});

	it("makes id the primary key with a random-uuid default", () => {
		expect(cols.id.primary).toBe(true);
		expect(cols.id.hasDefault).toBe(true);
	});
});
