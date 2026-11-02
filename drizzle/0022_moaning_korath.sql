ALTER TABLE "cdr_sync_state" ADD COLUMN "institutionName" text;--> statement-breakpoint
ALTER TABLE "cdr_sync_state" ADD COLUMN "accountNumber" text;--> statement-breakpoint
ALTER TABLE "cdr_sync_state" ADD COLUMN "balance" double precision;--> statement-breakpoint
ALTER TABLE "cdr_sync_state" ADD COLUMN "balanceAsOf" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cdr_sync_state" ADD COLUMN "nickname" text;