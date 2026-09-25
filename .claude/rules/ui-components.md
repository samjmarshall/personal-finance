---
paths:
  - "src/app/**"
  - "src/components/**"
---

# UI component placement

A component lives at the **lowest folder that covers every page that uses it**.
Place by who imports it, not by what it looks like.

| Used by                                                  | Lives in                                   | Example                                               |
| -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| One page                                                 | `_components/` next to that `page.tsx`     | `src/app/(dashboard)/expenses/categories/_components/category-form.tsx` |
| 2+ child pages of one parent / domain                    | the parent's `_components/`                | a form used by `expenses/categories/` + `expenses/unplanned/` → `src/app/(dashboard)/expenses/_components/` |
| 2+ parents / domains, or 2+ route groups                 | `src/components/`                          | `src/components/money.tsx`, `src/components/page-header.tsx` |

- `src/components/ui/` is shadcn primitives only — generated, not app components.
- `(dashboard)/_components/` serves the dashboard home `(dashboard)/page.tsx`
  (one page), not the whole route group. Group-wide shared code goes in
  `src/components/`.
- Colocated helpers and tests move with their component
  (`receipts/_components/prep-receipt.ts` + `prep-receipt.test.ts`).

## Moving on reuse

- Page B starts importing a component from page A's `_components/` → move it
  **up** to the lowest shared parent in the same change. Never import across
  sibling `_components/` folders (`income/` → `transactions/_components/`).
- Last cross-parent consumer drops it → move it **down** again.
- Import `src/components/*` via `~/components/...`; import `_components/` via a
  relative path from the page (or a descendant).
