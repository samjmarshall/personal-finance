# E2E Cleanup Patterns

## The failure mode

Broad-filter cleanup after tests that create external records is unreliable. External APIs (e.g. search endpoints) are eventually consistent — a record created at test time may not appear in a search query run seconds later. Cleanup that relies on searching silently leaves rows behind.

## The fix pattern

Each spec maintains a local set of created identifiers (phone numbers, emails, or IDs). Push every created identifier into the set at creation time; delete by those exact identifiers in `afterAll`. Never search.

```ts
const createdPhones = new Set<string>();

test("creates a contact", async () => {
  const phone = `+1555${Date.now()}`;
  await createContact({ phone });
  createdPhones.add(phone);
  // assertions...
});

afterAll(async () => {
  for (const phone of createdPhones) {
    await deleteContactByPhone(phone);
  }
});
```

## Test data isolation

Generate a unique identifier per run (timestamp + random suffix). Never reuse a phone number or email across specs — collisions hit unique constraints and mask real failures.

## dotenv load order

If a spec or fixture reads env vars, call `dotenv.config()` before importing any module that triggers env validation. Import order matters; the call must come first.

## When not to use

Read-only specs and specs that hit only an isolated local database have no eventual-consistency risk — skip the tracking set.

See the project's `CLAUDE.md` (or equivalent) for canonical E2E guardrails.
