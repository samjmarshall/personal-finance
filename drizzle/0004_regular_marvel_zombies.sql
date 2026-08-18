-- Converts transaction.frequency / transaction.priority from text to Postgres enums.
-- Data step: pre-sanitise any legacy/out-of-vocab rows to the column default before
-- the ::enum cast (which rejects unknown values), mirroring toFrequency/toPriority.
-- Rollback: ALTER both columns back to text, then DROP TYPE the two enums; values
-- coerced by the sanitise UPDATEs are NOT recoverable.
UPDATE "transaction" SET "frequency" = 'One-off'
	WHERE "frequency" NOT IN ('Recurring', 'One-off');--> statement-breakpoint
UPDATE "transaction" SET "priority" = 'Nice to Have'
	WHERE "priority" NOT IN ('Must Have', 'Should Have', 'Nice to Have', 'Fix', 'VERIFY - possible fraud', 'n/a');--> statement-breakpoint
CREATE TYPE "public"."transaction_frequency" AS ENUM('Recurring', 'One-off');--> statement-breakpoint
CREATE TYPE "public"."transaction_priority" AS ENUM('Must Have', 'Should Have', 'Nice to Have', 'Fix', 'VERIFY - possible fraud', 'n/a');--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DATA TYPE "public"."transaction_frequency" USING "frequency"::"public"."transaction_frequency";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DEFAULT 'One-off';--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DATA TYPE "public"."transaction_priority" USING "priority"::"public"."transaction_priority";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DEFAULT 'Nice to Have';
