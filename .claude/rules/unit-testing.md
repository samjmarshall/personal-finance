---
paths:
  - "src/**/*.test.ts"
  - "src/**/*.test.tsx"
  - "vitest.config.ts"
---

# Unit & Integration Testing (Vitest)

## Colocate tests — no `__tests__` folders

Vitest test files live **next to the file they test**, sharing its name with a
`.test.ts` suffix: `foo.ts` → `foo.test.ts` in the same directory.

**Never** create a `__tests__/` folder (nor `__test__/`, `test/`, `tests/`) to hold
them. The colocated file is the only sanctioned home. `vitest.config.ts` collects
`src/**/*.test.ts` (node) and `src/**/*.test.tsx` (jsdom), so a colocated file is
picked up with no config change.

A cross-cutting test with no single subject file (e.g. a golden/tripwire spanning
several modules) still colocates in its module directory — never in a `__tests__/`
subfolder.

## Component tests

- `foo.tsx` pairs with `foo.test.tsx` in the same folder. It runs in the
  `component` (jsdom) project automatically.
- Query the way a Member perceives the UI: by role, label or text. Never by class
  name. Use a test id only when no role exists.
- Use `userEvent.setup()` for interaction.
- jsdom loads no subresources, so drive `<img>` / `<iframe>` with `fireEvent.load` /
  `fireEvent.error`.
- Base UI dialogs portal into `document.body`, so query through `screen`, not the
  render container.
- Test props-driven components. A component that calls `api.*` hooks is covered
  through its props-driven children until a tRPC test provider exists.
- jsdom shims live in `src/test/setup-dom.ts`. Add one only when a failing test
  proves it is needed, each with a one-line reason.

Playwright end-to-end specs are separate: they live under `e2e/` — see
[e2e-testing](./e2e-testing.md).
