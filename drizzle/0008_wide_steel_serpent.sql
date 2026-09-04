ALTER TABLE "outbox" RENAME COLUMN "eventName" TO "name";--> statement-breakpoint
ALTER TABLE "outbox" RENAME COLUMN "payload" TO "data";--> statement-breakpoint
CREATE TYPE "public"."outbox_event_name" AS ENUM('receipt/uploaded', 'receipt/email.received', 'receipt/retry');--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "name" SET DATA TYPE "public"."outbox_event_name" USING "name"::"public"."outbox_event_name";