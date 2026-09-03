import { sql } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";

// Transactional outbox (adr002): canonical writes + an outbox row commit together,
// a best-effort post-commit send is the fast path, the sweep cron the backstop.
export const outbox = pgTable(
	"outbox",
	(d) => ({
		// App supplies its own uuid (the Inngest idempotency key); the default covers
		// raw-SQL INSERTs from migrations (the migration→workflow trigger idiom).
		id: d.uuid().primaryKey().defaultRandom(),
		eventName: d.text().notNull(),
		payload: d.jsonb().notNull(),
		createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
		processedAt: d.timestamp({ withTimezone: true }),
		attempts: d.integer().notNull().default(0),
		lastError: d.text(),
	}),
	(t) => [
		index("outbox_unprocessed_idx")
			.on(t.processedAt, t.createdAt)
			.where(sql`${t.processedAt} is null`),
	],
);
