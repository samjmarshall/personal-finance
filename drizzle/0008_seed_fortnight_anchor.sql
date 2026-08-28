-- Seed the household fortnight anchor (a payday, YYYY-MM-DD) so the Unplanned
-- period picker can offer fortnight windows. Upsert, not a bare INSERT: the row
-- is set-once but may already exist from a manual branch-DB seed, and re-running
-- must converge on this value rather than fail on the "key" primary key.
-- Rollback: DELETE FROM "app_setting" WHERE "key" = 'fortnightAnchor';
INSERT INTO "app_setting" ("key", "value") VALUES ('fortnightAnchor', '2026-08-12')
	ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
