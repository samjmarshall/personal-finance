-- Converts transaction.frequency / transaction.priority from text to Postgres enums.
-- Data step: fail loud if any legacy/out-of-vocab row exists before the ::enum cast
-- (which rejects unknown values). Aborts the migration so a human writes a deliberate
-- remap instead of silently coercing rows to the default — the source values are
-- otherwise unrecoverable. On a clean single-household DB this is a no-op guard.
-- Rollback: ALTER both columns back to text, then DROP TYPE the two enums.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "transaction"
		WHERE "frequency" NOT IN ('Recurring', 'One-off'))
	THEN RAISE EXCEPTION 'transaction.frequency has out-of-vocab values; triage before enum cast'; END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "transaction"
		WHERE "priority" NOT IN ('Must Have', 'Should Have', 'Nice to Have', 'Fix', 'VERIFY - possible fraud', 'n/a'))
	THEN RAISE EXCEPTION 'transaction.priority has out-of-vocab values; triage before enum cast'; END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."transaction_frequency" AS ENUM('Recurring', 'One-off');--> statement-breakpoint
CREATE TYPE "public"."transaction_priority" AS ENUM('Must Have', 'Should Have', 'Nice to Have', 'Fix', 'VERIFY - possible fraud', 'n/a');--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DATA TYPE "public"."transaction_frequency" USING "frequency"::"public"."transaction_frequency";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DEFAULT 'One-off';--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DATA TYPE "public"."transaction_priority" USING "priority"::"public"."transaction_priority";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DEFAULT 'Nice to Have';
