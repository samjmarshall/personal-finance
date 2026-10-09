-- Step 6 commit C, file 2 of 2 (adr025): a linked Transaction takes its Category
-- from the Expense, so a row may hold an expenseId or a categoryId, not both.
-- 0015 cleared the rows that held both.
-- Rollback:
--   ALTER TABLE "transaction" DROP CONSTRAINT "transaction_expense_or_category_check";
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_expense_or_category_check" CHECK ("transaction"."expenseId" IS NULL OR "transaction"."categoryId" IS NULL);