-- Step 6 tidy (adr024): 0012 renamed the table but Postgres kept the old primary
-- key name. Renaming the constraint renames its index too.
-- Rollback: ALTER TABLE "category" RENAME CONSTRAINT "category_pkey" TO "expense_category_pkey";
ALTER TABLE "category" RENAME CONSTRAINT "expense_category_pkey" TO "category_pkey";
