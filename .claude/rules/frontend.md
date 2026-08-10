---
paths:
  - "src/components/**"
  - "src/app/**"
  - "src/providers/**"
  - "src/hooks/**"
---

# Frontend

## Building & Reviewing UI

Use the `frontend-design` skill when implementing UI components, pages, or layouts. After completing UI/UX work in `src/`, run `/design-review` before committing.

## Frontend Architecture

**Context Providers**: reserved for genuinely global state (auth, theme, feature flags, transport clients, routing). For page- or modal-local state, inline `useState` in the owning component and pass values down as explicit named props — never extract into a custom hook (callable elsewhere) or a Context Provider (widens the read/write surface to the whole subtree). See [adr001](../../docs/adr/adr001-context-providers-for-global-state-only.md).
