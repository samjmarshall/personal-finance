CREATE TYPE "public"."transaction_frequency" AS ENUM('Recurring', 'One-off');--> statement-breakpoint
CREATE TYPE "public"."transaction_priority" AS ENUM('Must Have', 'Should Have', 'Nice to Have', 'Fix', 'VERIFY - possible fraud', 'n/a');--> statement-breakpoint
CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "amount" DROP DEFAULT;--> statement-breakpoint
-- Convert transaction.frequency / transaction.priority from text to the enums above.
-- Fail loud if any out-of-vocab row exists before the ::enum cast (which rejects unknown
-- values), so a human writes a deliberate remap instead of silently coercing to the default
-- — the source values are otherwise unrecoverable. On a clean single-household DB, a no-op.
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
-- SET DEFAULT is split around SET DATA TYPE (drop first, re-add after the cast): an enum
-- default can't be cast onto a still-text column, so drizzle's default-first order is reordered.
ALTER TABLE "transaction" ALTER COLUMN "frequency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DATA TYPE "public"."transaction_frequency" USING "frequency"::"public"."transaction_frequency";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "frequency" SET DEFAULT 'One-off';--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DATA TYPE "public"."transaction_priority" USING "priority"::"public"."transaction_priority";--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "priority" SET DEFAULT 'Nice to Have';--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "expenseId" integer;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "expenseCategoryId" integer;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_expenseId_expense_id_fk" FOREIGN KEY ("expenseId") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_expenseCategoryId_expense_category_id_fk" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."expense_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_expense_idx" ON "transaction" USING btree ("expenseId");--> statement-breakpoint
CREATE INDEX "transaction_expense_category_idx" ON "transaction" USING btree ("expenseCategoryId");--> statement-breakpoint
-- Seed the household fortnight anchor (a payday, YYYY-MM-DD) so the Unplanned period picker
-- can offer fortnight windows. Upsert, not a bare INSERT: set-once but converges if a manual
-- branch-DB seed already exists, rather than failing on the "key" primary key.
-- Rollback: DELETE FROM "app_setting" WHERE "key" = 'fortnightAnchor';
INSERT INTO "app_setting" ("key", "value") VALUES ('fortnightAnchor', '2026-08-12')
	ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
