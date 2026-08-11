---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-11'
# prettier-ignore
---

# Adopt shadcn/ui on Base UI for shared UI primitives

Design: [2026-08-11 Install shadcn/ui on Base UI and migrate the hand-rolled components](../../thoughts/designs/2026-08-11-shadcn-base-ui-migration.md)

## Context and Problem Statement

The app's UI primitives are hand-rolled: roughly 2,500 lines across `primitives.tsx` (Button, Input, Textarea, Select, Field, Badge, Card) and `modal.tsx`. Ten files import the primitives, four import the modal. Several are not merely plain but wrong: the modal has no focus trap and renders its backdrop as a full-screen `<button aria-label="Close dialog">` that a screen reader announces as a giant button over the page; four `confirm()` calls and one `alert()` fall back to browser dialogs; the native `<select>` resists styling. As the view count grows, hand-rolling each new primitive — with its own focus, keyboard, and ARIA behaviour — does not scale.

Radix UI was the standard headless primitive layer for years and is what shadcn/ui was built on. It is now winding down, and its authors have moved to Base UI, which shadcn made its **default** base in July 2026.

Do we keep hand-rolling, adopt shadcn on the familiar Radix base, or adopt shadcn on Base UI?

## Decision Drivers

- **Accessibility and correctness.** Focus trap, focus restore, scroll lock, real `role="dialog"` semantics, and a stylable select/combobox are table stakes we do not currently meet. This is the driver that makes the change worth its churn.
- **Velocity.** Stop authoring focus/keyboard/ARIA behaviour by hand for every new primitive.
- **Future-proofing.** Pick the base its authors are actively maintaining, not the one they are leaving, before the component count grows and raises the switching cost.
- **Visual continuity.** Light mode must not move. The Card, Badge, and table layouts are load-bearing to the current look; a diff there is a bug, not a judgement call.

## Considered Options

1. **Continue hand-rolling** — fix the modal and dialogs in place, keep authoring primitives ourselves.
2. **shadcn/ui on Radix** — `npx shadcn@latest init -b radix`, the build that was standard for years.
3. **shadcn/ui on Base UI** — plain `init`, Base UI as the default base.

## Decision Outcome

Chosen option: **3, shadcn/ui on Base UI**, because it is the only option that satisfies the future-proofing driver without giving up the accessibility and velocity gains of options that vendor a maintained primitive layer. Option 2 buys the same components on a base its own authors are leaving; option 1 buys nothing and keeps the correctness debt.

The primitives are vendored into `src/components/ui/` — we own the source outright, so a future migration off Base UI is a per-component edit, not a dependency swap. That containment is what makes accepting a young base tolerable.

### Positive Consequences

- The modal becomes a real `dialog` with focus trap, focus restore, and scroll lock; `alert-dialog` replaces the four blocking `confirm()` calls; `select` and `combobox` replace the unstylable native controls. The accessibility driver is met at the primitive level, once, rather than per view.
- We track the maintained base. When Radix-era snippets circulate, we translate them once (see negatives) rather than inheriting a deprecated dependency.
- Vendored source means no version lock-in on the primitive library itself: the components are ours to edit, and `cn` / Tailwind v4 / lucide are already in the tree.

### Negative Consequences

- Base UI is young. v1.0.0 shipped December 2025; we adopt v1.7.0 (2026-08-04). The ecosystem of copy-paste snippets still assumes Radix, so Radix-era examples need translating: `asChild` becomes the `render` prop, and exit-animation timing differs — `keepMounted` is not `forceMount`. Getting this wrong shows up as a broken animation or a duplicated DOM node, not a type error.
- shadcn encodes the base and the visual theme in a single `components.json` `style` key (`base-nova` for Base UI). The theme is not purely a wiring switch, so the "light mode does not change" guarantee depends on Nova's button/input/card geometry matching the hand-rolled values — verified per component during migration, not assumed.
- The `select` migration is a real API change across six sites (`onChange`/`e.target.value` → `onValueChange`, `<option>` → `<SelectItem>`), and Base UI represents "no selection" as `null` rather than the empty string the current filters pass. This is behavioural surface that must be re-tested, not a rename.

## Pros and Cons of the Options

### 1. Continue hand-rolling

| Pros | Cons |
| ----- | ----- |
| Zero new dependencies; full control | Leaves the correctness debt — every fix (focus trap, dialog state, stylable select) is bespoke work |
| No API translation | Does not scale: each new primitive re-authors focus/keyboard/ARIA by hand |
| No visual risk | Fails the velocity and future-proofing drivers outright |

### 2. shadcn/ui on Radix

- Good, because Radix is mature and the snippet ecosystem assumes it — least translation friction today.
- Good, because it delivers the same accessibility wins as option 3.
- Bad, because Radix is winding down and its authors have moved to Base UI; adopting it now buys a base we would migrate off later, at a higher component count.
- Bad, because it is no longer shadcn's default, so we would be pinning against the receding path (`-b radix`) rather than the maintained one.

### 3. shadcn/ui on Base UI

- Good, because it is the maintained base its authors landed on, and shadcn's default — the lowest long-run switching cost.
- Good, because it delivers the accessibility and velocity wins, with the primitives vendored into our tree so we own the source.
- Bad, because Base UI is young and the snippet ecosystem still assumes Radix, adding per-component translation cost during migration.
- Bad, because Base UI's API differs from Radix's (`render` vs `asChild`, `keepMounted` vs `forceMount`), so borrowed examples can break silently.

## Links

- Design: [2026-08-11 shadcn/Base UI migration](../../thoughts/designs/2026-08-11-shadcn-base-ui-migration.md)
- Refined by [adr009](adr009-react-hook-form-over-tanstack-form.md) — form library for the deferred forms work
