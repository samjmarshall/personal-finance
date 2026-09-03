DROP INDEX "outbox_unprocessed_idx";--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("createdAt") WHERE "outbox"."processedAt" is null;