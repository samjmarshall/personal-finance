import { sql } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";
import type { EventName } from "~/server/inngest/events";

// Transactional outbox (adr002): canonical writes + an outbox row commit together,
// a best-effort post-commit send is the fast path, the sweep cron the backstop.
export const outbox = pgTable(
	"outbox",
	(d) => ({
		// App supplies its own uuid (the Inngest idempotency key); the default covers
		// raw-SQL INSERTs from migrations (the migration→workflow trigger idiom).
		id: d.uuid().primaryKey().defaultRandom(),
		// text, not a pgEnum: a new event would otherwise need an ALTER TYPE … ADD
		// VALUE migration (PG can't drop values on rename, and same-migration ADD
		// VALUE + INSERT aborts). Runtime safety lives at the buildOutboxEvent mint
		// boundary (EVENT_REGISTRY), so the column stays a plain typed string.
		name: d.text().$type<EventName>().notNull(),
		data: d.jsonb().notNull(),
		createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
		processedAt: d.timestamp({ withTimezone: true }),
		attempts: d.integer().notNull().default(0),
		lastError: d.text(),
	}),
	(t) => [
		// Partial index for the sweep. WHERE processedAt IS NULL pins processedAt constant
		// within the set, so createdAt alone serves both the age filter and the ORDER BY —
		// leading with processedAt would add a zero-selectivity column.
		index("outbox_unprocessed_idx")
			.on(t.createdAt)
			.where(sql`${t.processedAt} is null`),
	],
);
