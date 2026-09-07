-- Rename outbox columns eventName -> name, payload -> data. name stays plain text;
-- event-name safety lives at the buildOutboxEvent mint boundary (EVENT_REGISTRY), not
-- an enum, so a new event never needs an ALTER TYPE … ADD VALUE migration.
-- Rollback:
--   ALTER TABLE "outbox" RENAME COLUMN "name" TO "eventName";
--   ALTER TABLE "outbox" RENAME COLUMN "data" TO "payload";
ALTER TABLE "outbox" RENAME COLUMN "eventName" TO "name";--> statement-breakpoint
ALTER TABLE "outbox" RENAME COLUMN "payload" TO "data";
