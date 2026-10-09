-- Step 6 commit C, file 1 of 2 (adr025): a linked Transaction takes its Category
-- from the Expense, so clear its own before 0016 adds the check.
-- Pre-flight (2026-10-07, fresh branch of prod): 1 linked Transaction held its own
-- Category, 0 of them disagreeing with their Expense's. The Expense's Category wins.
-- Rollback: not recoverable; restore from the Neon branch.
UPDATE "transaction" SET "categoryId" = NULL WHERE "expenseId" IS NOT NULL;
