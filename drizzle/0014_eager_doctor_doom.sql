-- Step 6, file 3 of 3 (adr024): every Expense now has a categoryId (0013), so
-- make it required and drop the old name text. The sequence rename is hand-added:
-- drizzle-kit emits no SQL for an identity name change, and it crashed when 0012
-- carried this change alongside the table rename.
-- Rollback:
--   ALTER SEQUENCE "category_id_seq" RENAME TO "expense_category_id_seq";
--   ALTER TABLE "expense" ADD COLUMN "category" text;
--   UPDATE "expense" e SET "category" = c."name" FROM "category" c WHERE c."id" = e."categoryId";
--   ALTER TABLE "expense" ALTER COLUMN "category" SET NOT NULL;
--   ALTER TABLE "expense" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER SEQUENCE "expense_category_id_seq" RENAME TO "category_id_seq";--> statement-breakpoint
ALTER TABLE "expense" ALTER COLUMN "categoryId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" DROP COLUMN "category";