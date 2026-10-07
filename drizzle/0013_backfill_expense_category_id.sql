-- Step 6, file 2 of 3 (adr024): link each Expense to its Category by id. The match
-- is exact, like the old name join. An Expense whose name matches no Category goes
-- under "Needs refiling", created only if one exists.
-- Pre-flight (2026-10-07, fresh branch of prod): 0 orphan names, so no
-- "Needs refiling" row is expected.
-- Rollback: nothing to undo beyond 0012's; the "Needs refiling" row can be
-- deleted once Expenses move off it.
UPDATE "expense" e SET "categoryId" = c."id" FROM "category" c WHERE c."name" = e."category";--> statement-breakpoint
INSERT INTO "category" ("name", "description", "sortOrder", "createdAt")
SELECT 'Needs refiling', 'Expenses whose category name matched no Category during the step 6 migration.',
       (SELECT coalesce(max("sortOrder") + 1, 0) FROM "category"), now()
WHERE EXISTS (SELECT 1 FROM "expense" WHERE "categoryId" IS NULL)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "expense" SET "categoryId" = (SELECT "id" FROM "category" WHERE "name" = 'Needs refiling')
WHERE "categoryId" IS NULL;
