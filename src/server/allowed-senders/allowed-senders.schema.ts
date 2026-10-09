import { index, pgTable, unique } from "drizzle-orm/pg-core";
import { user } from "~/server/auth/auth.schema";

export const allowedSenders = pgTable(
	"allowed_sender",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		// Lower-cased and trimmed by allowedSenderCreateDto so the unique index below
		// and the webhook's sender lookup compare the same shape.
		email: d.text().notNull(),
		// cascade, not set null: an allowlist entry is pure config, meaningless once
		// its Member is gone — unlike a Receipt, which outlives its owner.
		userId: d
			.text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [
		// One address maps to exactly one Member, so inbound mail attributes unambiguously.
		unique("allowed_sender_email_unique").on(t.email),
		index("allowed_sender_user_idx").on(t.userId),
	],
);
