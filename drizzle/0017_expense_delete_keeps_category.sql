-- adr025: deleting an Expense must not lose the filing of its linked records.
-- Before the delete, unlink each record and copy the Expense's Category onto it,
-- in the same statement, so the ON DELETE SET NULL finds nothing left to clear.
-- Line items keep a Category of their own until step 7 brings them under the check.
-- Rollback: DROP TRIGGER "expense_keep_category" ON "expense";
--           DROP FUNCTION "expense_keep_category"();
CREATE FUNCTION "expense_keep_category"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	UPDATE "transaction"
	SET "expenseId" = NULL, "categoryId" = OLD."categoryId"
	WHERE "expenseId" = OLD."id";
	UPDATE "receipt_item"
	SET "expenseId" = NULL, "categoryId" = coalesce("categoryId", OLD."categoryId")
	WHERE "expenseId" = OLD."id";
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expense_keep_category"
BEFORE DELETE ON "expense"
FOR EACH ROW EXECUTE FUNCTION "expense_keep_category"();
