CREATE TYPE "public"."balance_source" AS ENUM('manual', 'cdr');--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD COLUMN "source" "balance_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cdr_sync_state" ADD COLUMN "inBalance" boolean;