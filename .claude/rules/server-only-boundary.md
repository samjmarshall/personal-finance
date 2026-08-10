---
paths:
  - "src/server/**"
  - "src/domain/**"
---

# Server-only boundary

Every non-test `.ts` file under `src/server/**` carries `import "server-only";` as its first line. Any client-bundle path that transitively reaches a marked module fails `make build` ("This module cannot be imported from a Client Component module").

When adding a module under `src/server/**`, prepend `import "server-only";`. Isomorphic code belongs in `src/domain/**` (the kernel — scoring, correlation, shared Zod schemas) and is **never** marked. `src/lib/**` holds client surfaces (`auth-client.ts`, `posthog.ts`, `analytics.ts`) and isomorphic utils, all unmarked — with one exception: `src/lib/posthog-server.ts` is a server-side module (imported only from `src/instrumentation.ts`) that carries the `server-only` marker while it awaits relocation under `src/server/**`.

## The mechanism (personal-finance-specific — read before "fixing" tooling)

`server-only` throws at import time unless Node runs with the `react-server` export condition. `next build` sets it; bare `tsx` / `drizzle-kit` / rstest don't. personal-finance wires this in the **Makefile**, not in package.json:

- **Global:** `export NODE_OPTIONS=--conditions=react-server` at the top of the Makefile — every make target (build, db_*, smoke_draft, script runners) inherits it.
- **Deliberate unexport:** `test test_coverage test_integration: NODE_OPTIONS=` — under the react-server condition Node resolves `react` to its react-server build (no `createContext`/`useLayoutEffect`), breaking component tests. Rstest instead stubs the marker via `resolve.alias` (`rstest.config.ts` → `rstest.server-only-stub.ts`), so its targets must NOT inherit the condition. Do not "fix" the unexport.
- **package.json scripts stay bare** — the condition is make's job. Running a script that imports marked modules directly via `yarn`/`tsx` will throw; run it through its make target (e.g. `make smoke_draft`). drizzle-kit has proven empirically tolerant of the marker, but the db targets go through make (and inherit the condition) anyway.
