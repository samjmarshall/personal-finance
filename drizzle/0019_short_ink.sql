CREATE TYPE "public"."transaction_provenance" AS ENUM('manual', 'import', 'cdr', 'paypal');--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "provenance" "transaction_provenance" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "externalId" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "accountName" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_provenance_external_idx" ON "transaction" USING btree ("provenance","externalId") WHERE "transaction"."externalId" is not null;