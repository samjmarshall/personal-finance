---
paths:
  - "e2e/**"
---

# E2E Testing

**_BEFORE marking e2e test changes complete:_** Audit every locator in every method you modified or called. If any uses `getByRole()`, `getByText()`, `getByLabel()`, or CSS selectors instead of `getByTestId()`, check the source component — if it already has a `data-testid`, switch to it; if not, add one to the source, then kill any Next.js server and build and start to verify. This is a **blocking gate** — do not check off e2e test task items until this audit is done.

Additional guardrails for all E2E specs:

- **Per-spec cleanup** — every spec that creates leads or HubSpot contacts tracks them by phone or email within that spec and cleans up in `afterAll`. Never rely on broad search filters — HubSpot search is eventually consistent and can miss a contact created moments earlier.
- **dotenv load order** — any script or fixture that reads env vars must call `dotenv.config()` **before** importing anything that triggers `~/env` validation.
- **Flake double-run** — if an E2E spec fails, re-run just that spec once before diagnosing. Only treat it as a real regression if it fails twice in a row.
- **Test data isolation** — never share a phone number or email across specs; collisions hit the unique constraint and mask real failures. Always generate a unique value per run (e.g., timestamp + random suffix).
