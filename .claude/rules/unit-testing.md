---
paths:
  - "src/**/*.test.ts"
  - "vitest.config.ts"
---

# Unit & Integration Testing (Vitest)

## Colocate tests — no `__tests__` folders

Vitest test files live **next to the file they test**, sharing its name with a
`.test.ts` suffix: `foo.ts` → `foo.test.ts` in the same directory.

**Never** create a `__tests__/` folder (nor `__test__/`, `test/`, `tests/`) to hold
them. The colocated file is the only sanctioned home. `vitest.config.ts` collects
`src/**/*.test.ts`, so a colocated file is picked up with no config change.

A cross-cutting test with no single subject file (e.g. a golden/tripwire spanning
several modules) still colocates in its module directory — never in a `__tests__/`
subfolder.

Playwright end-to-end specs are separate: they live under `e2e/` — see
[e2e-testing](./e2e-testing.md).
