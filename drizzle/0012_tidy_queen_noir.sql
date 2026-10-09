-- Step 6, file 1 of 3 (adr024): rename expense_category -> category, the Group
-- column transaction.category -> "group", the two expenseCategoryId columns ->
-- categoryId, and add a nullable expense."categoryId". 0013 backfills it; 0014
-- sets NOT NULL, drops expense.category and renames the identity sequence.
-- Rollback:
--   ALTER TABLE "category" DROP CONSTRAINT "category_name_unique";
--   DROP INDEX "transaction_category_idx";
--   DROP INDEX "expense_category_idx";
--   ALTER TABLE "transaction" DROP CONSTRAINT "transaction_categoryId_category_id_fk";
--   ALTER TABLE "receipt_item" DROP CONSTRAINT "receipt_item_categoryId_category_id_fk";
--   ALTER TABLE "expense" DROP CONSTRAINT "expense_categoryId_category_id_fk";
--   ALTER TABLE "expense" DROP COLUMN "categoryId";
--   ALTER TABLE "transaction" RENAME COLUMN "group" TO "category";
--   ALTER TABLE "transaction" RENAME COLUMN "categoryId" TO "expenseCategoryId";
--   ALTER TABLE "receipt_item" RENAME COLUMN "categoryId" TO "expenseCategoryId";
--   ALTER TABLE "category" RENAME TO "expense_category";
--   ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_name_unique" UNIQUE("name");
--   ALTER TABLE "transaction" ADD CONSTRAINT "transaction_expenseCategoryId_expense_category_id_fk" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."expense_category"("id") ON DELETE set null;
--   ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_expenseCategoryId_expense_category_id_fk" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."expense_category"("id") ON DELETE set null;
--   CREATE INDEX "transaction_expense_category_idx" ON "transaction" USING btree ("expenseCategoryId");
ALTER TABLE "expense_category" RENAME TO "category";--> statement-breakpoint
ALTER TABLE "receipt_item" RENAME COLUMN "expenseCategoryId" TO "categoryId";--> statement-breakpoint
ALTER TABLE "transaction" RENAME COLUMN "expenseCategoryId" TO "categoryId";--> statement-breakpoint
ALTER TABLE "transaction" RENAME COLUMN "category" TO "group";--> statement-breakpoint
ALTER TABLE "category" DROP CONSTRAINT "expense_category_name_unique";--> statement-breakpoint
ALTER TABLE "receipt_item" DROP CONSTRAINT "receipt_item_expenseCategoryId_expense_category_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_expenseCategoryId_expense_category_id_fk";
--> statement-breakpoint
DROP INDEX "transaction_expense_category_idx";--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "categoryId" integer;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_category_idx" ON "expense" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "transaction_category_idx" ON "transaction" USING btree ("categoryId");--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_name_unique" UNIQUE("name");