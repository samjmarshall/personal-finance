-- Phase 8 reopened (2026-11-01): a possible duplicate now needs the same amount, to the
-- cent. Each pending review whose amounts differ is answered "Both are real", as the
-- matcher now treats a new one: the bank row is added and the review goes. A kept
-- review stays, so its bank row is still skipped.
-- Pre-flight (2026-11-01, branch local/feat/expense-linking-stage-7-cdr-redbark): 137 of
-- 151 pending reviews differ in amount. The member reviewed this pile and found no real
-- duplicate in it.
-- Rollback: not recoverable; restore from the Neon branch.
WITH "released" AS (
	DELETE FROM "possible_duplicate" pd
	USING "transaction" t
	WHERE t."id" = pd."transactionId"
		AND pd."status" = 'pending'
		AND round(pd."amount" * 100) <> round(t."amount" * 100)
	RETURNING pd."provenance", pd."externalId", pd."externalAccountId", pd."accountName",
		pd."amount", pd."date", pd."description"
)
-- Skips a bank id already in "transaction", as bothReal does.
INSERT INTO "transaction" ("provenance", "externalId", "externalAccountId", "accountName",
	"amount", "date", "description", "createdAt")
SELECT "provenance", "externalId", "externalAccountId", "accountName", "amount", "date",
	"description", now()
FROM "released"
ON CONFLICT DO NOTHING;
