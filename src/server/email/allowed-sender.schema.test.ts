import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { allowedSenders } from "./allowed-sender.schema";

const cols = getTableColumns(allowedSenders);
const config = getTableConfig(allowedSenders);

describe("allowed_sender table shape", () => {
	// The webhook can't attribute mail it can't tie to a Member, so neither is optional.
	it("requires the address and its owning member", () => {
		expect(cols.email.notNull).toBe(true);
		expect(cols.userId.notNull).toBe(true);
	});

	it("makes id the identity primary key", () => {
		expect(cols.id.primary).toBe(true);
	});

	it("stamps createdAt by default", () => {
		expect(cols.createdAt.notNull).toBe(true);
		expect(cols.createdAt.hasDefault).toBe(true);
	});

	// Unlike a Receipt (kept forever as tax evidence), an allowlist entry is pure
	// config — it means nothing once its Member is gone, so it cascades away.
	it("cascades the entry away with its member", () => {
		expect(config.foreignKeys).toHaveLength(1);
		expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
	});

	// One address maps to exactly one Member, so inbound attribution is unambiguous.
	it("keeps one row per address", () => {
		expect(config.uniqueConstraints.map((u) => u.name)).toContain(
			"allowed_sender_email_unique",
		);
	});

	it("indexes the owning member", () => {
		expect(config.indexes.map((i) => i.config.name)).toContain(
			"allowed_sender_user_idx",
		);
	});
});
