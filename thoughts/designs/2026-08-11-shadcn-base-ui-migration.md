# Install shadcn/ui on Base UI and migrate the hand-rolled components

**Date:** 2026-08-11
**Status:** Design — validated, not yet planned

## Goal

Replace the hand-rolled UI primitives with shadcn/ui on Base UI. Keep the current
appearance. Fix the components that are actually broken.

Drivers, in the owner's words:

- **Accessibility and correctness.** The modal has no focus trap. Four `confirm()` calls
  and one `alert()` render as browser dialogs. The native `<select>` resists styling.
- **Velocity.** Stop hand-rolling primitives as the app grows.
- **Future-proofing.** Radix is winding down; Base UI is where its authors landed. Move
  before the component count grows.

**Adopt `base-nova` as shipped.** The vendored components are taken unmodified rather than
overridden back to the current geometry, so the app takes Nova's density: buttons and inputs
drop from `h-10` to `h-8`, radius goes `rounded-md` to `rounded-lg`, and the focus ring widens
to `ring-3 ring-ring/50`. This is a deliberate, app-wide visual change, chosen over carrying a
permanent fork of the registry's size values.

The consequence to plan for is `Card`. Nova's `Card` owns its own padding and layout; the
current one is a bare box that all fourteen call sites pad themselves. Those call sites are
restructured, not preserved.

## Current state

Tailwind v4, no shadcn, no Radix, no Base UI, no `cva`. Roughly 2,500 lines of components.

| File | Contents |
|---|---|
| `_components/ui/primitives.tsx` | `Button` (5 variants, 3 sizes), `Input`, `Textarea`, `Select`, `Field`, `Badge`, `Card` |
| `_components/ui/modal.tsx` | Hand-rolled dialog: Escape and scroll lock only, no focus trap |
| `_components/ui/money.tsx` | Domain currency display |
| `styles/globals.css` | Custom `@theme` block, single layer, no dark mode |

Ten files import `primitives`; four import `modal`.

Biome already lists `cva` in `useSortedClasses`. Vitest runs via `make test`, but
`vitest.config.ts` sets `environment: "node"` and includes only `src/**/*.test.ts` — no DOM,
and `.tsx` is not collected, so no component can be tested without new setup.

## Decisions

| # | Decision |
|---|---|
| 1 | Drivers are accessibility, velocity, and future-proofing. Take `base-nova` as shipped; accept its density as an app-wide visual change. |
| 2 | Adopt shadcn's canonical token names, keep the existing values, keep the domain tokens. `destructive` becomes its own token. |
| 3 | Ship full dark mode, including a toggle. |
| 4 | The sidebar is mode-invariant — authored once, absent from `.dark`. `sidebar-accent` remaps to `sidebar-primary`. Constrains dark `--background` to sit well below `0.22`. |
| 5 | Vendored files in `src/components/ui/`, shared composites in `src/components/`, domain composites in `src/app/_components/`. Delete `primitives.tsx` outright — no re-export shim, and `_components/ui/` goes with it. |
| 6 | Adopt `react-hook-form`, not `@tanstack/react-form`. |
| 7 | Forms land **after** the migration, as a separate change. |
| 8 | Skip `table` and Recharts. Include `combobox`. |
| 8a | `combobox` makes Transaction category a **constrained** dropdown, sourced from `expense_category`, not the distinct-values query. |
| 8b | No schema changes anywhere. `transactions.category` stays a plain text label; category CRUD behaviour is untouched and handled separately. |
| 9 | Theme toggle: desktop sidebar only, two states, `defaultTheme="system"`. |
| 10 | Rename the `positive` token to `inflow`, in step 2. Six edits. |
| 11 | Dark `--border` and `--input` are translucent white overlays, not opaque greys. |
| 12 | Step 7 wires mutation errors to Sonner only. The inline validation boxes survive until the react-hook-form follow-up. |
| 12a | One global `MutationCache.onError` in `createQueryClient`, not per-site handlers. `meta` customises and opts out. |
| 13 | `Select` uses Base UI's `null` for "no selection". No sentinel string. |
| 14 | Step 3 splits: 3a controls, 3b `card` plus its fourteen call sites. |
| 15 | `themeColor` uses Next's `prefers-color-scheme` array form. Safe only while mobile has no toggle. |
| 16 | Nova's 32px controls ship on touch too. No size overrides. `/design-review` at 3a checks the mobile header on a phone viewport. |
| 17 | `ConfirmDialog` is a controlled component taking props, not a `useConfirm()` hook. Each view holds its own pending-row `useState`. |
| 18 | Nova's dialog geometry ships as-is — centred, 384px, `p-4`. Add back `max-h-[90vh] overflow-y-auto` only. Reachability is correctness, not appearance. |
| 19 | Tokenise the two hardcoded priority badges (`Should Have`→`accent`, `Fix`→`warning`) in step 2, so they remap in dark. Step 2's diff is no longer strictly zero. |
| 20 | adr008 and adr009 flip `Proposed`→`Accepted`. The decisions are made; status follows adr007's decided-before-merge pattern. |
| 21 | The picker reuses `category.list`, mapped to names in the view. No dedicated `category.names` procedure. |

## Research

Base UI became shadcn's **default** in July 2026. It is not a separate registry — plain
`init` selects it, and `-b radix` opts out. Base UI itself is stable: v1.0.0 shipped
December 2025, v1.7.0 on 4 August 2026, published as `@base-ui/react`. No compatibility
problems are reported against Tailwind v4, React 19, or Next.js 16.

Two API differences matter. Base UI uses a `render` prop where Radix used `asChild`, so
Radix-era snippets need translating. Exit-animation timing differs — `keepMounted` is not
`forceMount`.

shadcn removed its react-hook-form-coupled `<Form>` component. A library-agnostic `field`
family replaces it, with integration guides for react-hook-form, TanStack Form, and
Formisch.

Sources: [shadcn changelog, July
2026](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default),
[theming](https://ui.shadcn.com/docs/theming), [Base UI
releases](https://base-ui.com/react/overview/releases).

### Form library comparison

Retrieved live on 2026-08-11.

| | react-hook-form | @tanstack/react-form |
|---|---|---|
| Weekly npm downloads | **58.2M** | 2.5M |
| GitHub stars | 44,819 | 6,646 |
| Open issues | **1** | 111 |
| Latest release | v7.85.0 (2026-08-08) | v1.33.4 |
| Maturity | v7 since 2021 | 1.0 on 2025-03-02 |
| State of React 2025 | 74% usage | 21%, up 8 places |
| Bundle, gzip | 17.4 kB + 4.9 kB resolver | 22.1 kB, no resolver |

Bundle size ties once the resolver counts. shadcn documents both against `field`, so its
integration no longer favours either. TanStack takes a zod v4 schema directly through
Standard Schema; react-hook-form needs `@hookform/resolvers` 5.7.1.

TanStack's advantages barely apply here. Its server-action primitives overlap tRPC. Its
stronger path inference only pays off on deeply nested forms, and these hold five to seven
flat fields.

Adoption was an explicit criterion, the gap is 23×, and the owner has three years of
react-hook-form. That decides it.

## Design

### 1. Foundation

Run `npx shadcn@latest init` — yarn 1 has no `dlx`. Base UI is the default, so pass no
`-b` flag.

Point the aliases at `~/`, not shadcn's `@/`:

```
components → ~/components
ui         → ~/components/ui
utils      → ~/lib/utils
lib        → ~/lib
hooks      → ~/hooks
```

`~/lib/utils` already exports `cn` with the `clsx` + `twMerge` body shadcn expects. Confirm
the CLI adopts it rather than overwriting `formatCurrency` and `formatDate`.

**Read the `globals.css` diff before accepting it.** On Tailwind v4 the CLI writes its token
block into the file named by `components.json`'s `tailwind.css`. The existing `@theme` holds
`--color-positive`, `--color-spend`, `--color-sidebar` and `--radius`, none of which shadcn
knows about. Appending its own tokens is harmless at this step — nothing consumes them until
3a — but replacing the block would break the hand-rolled components immediately, which is why
step 1 claims a zero visual diff and why a diff here is the signal to stop.

New dependencies: `@base-ui/react` 1.7.0, `class-variance-authority`, `next-themes`.
Reused: `clsx`, `tailwind-merge`, `lucide-react`.

The CLI writes `^` ranges. Pin them — `.claude/rules/package.json.md` requires it. The CLI
also writes spaces and unsorted JSX attributes, so run `yarn run check:write` after every
`add` before reading the diff.

### 2. Token layer

Split `globals.css` in two. Raw values in `:root`, utilities mapped in `@theme inline`:

```css
:root { --primary: oklch(0.46 0.086 178); }
@theme inline { --color-primary: var(--primary); }
```

That indirection is what `@custom-variant dark (&:is(.dark *))` hooks into. The current
single-layer `@theme` block cannot support dark mode.

The **layering** is what dark mode needs; the **naming** is a separate question, and the two
are independent — the split above works just as well over a bespoke vocabulary. Canonical
names are adopted for a different reason: every component pulled from the registry arrives
hard-coded to `bg-secondary`, `bg-popover`, `text-destructive`. Keeping our own vocabulary
would mean editing those classes in every vendored component, on every `add`, forever.

shadcn's `@layer base` replaces the existing global rules:

```css
@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

**Light mode values do not change.** Thirteen tokens carry across untouched.
`--radius: 0.625rem` already matches shadcn's default. Keep the teal
`--ring: oklch(0.52 0.09 175)` over shadcn's neutral grey — though note the ring's *colour* is
all that carries: Nova draws it at `ring-3 ring-ring/50` where the current primitives use
`ring-2 ring-ring`, so the focus ring does widen and soften at step 3a.

Add `secondary`, `popover`, `destructive`, `chart-1` through `chart-5`, the radius scale,
and the eight-token `sidebar-*` set.

Keep `spend` and `warning` as domain tokens. `destructive` starts at `spend`'s value but stays
separate, because deleting a record and spending money are different ideas. Note that shadcn
dropped `--destructive-foreground`; `destructive` has no paired token.

**Rename `positive` to `inflow`.** `--color-positive` and `--color-positive-foreground` become
`--color-inflow` and `--color-inflow-foreground`, with `text-positive` updated at
`money.tsx:28,35` and `page.tsx:33,47` — six edits, and no others; `positive` appears nowhere
else. The word collides head-on with the ledger's sign convention, where a **positive**
`amount` is a Spend and renders red. See [CONTEXT.md](../../CONTEXT.md).

Step 2 is the moment for it: the token block is being rewritten line by line anyway, and the
rename cannot change rendering. It does widen a diff whose promise is "no visual change" — so
review it as two passes, values first, then the rename.

**Tokenise the two hardcoded priority badges** while in `constants.ts`. `PRIORITY_STYLES` has
six entries; four already colour by token (`bg-primary/10`, `bg-spend/10`, `bg-muted`), but
`"Should Have"` and `"Fix"` hardcode raw oklch — `bg-[oklch(0.95_0.03_175)]` and
`bg-[oklch(0.95_0.06_75)]` with matching text and border. Rewrite them to the
`bg-X/10 text-X border-X/25` pattern the other two tinted badges use: `"Should Have"` onto
`accent`, `"Fix"` onto `warning` (its dot is already `bg-warning`). The replaced values differ
from those tokens by ≤0.01 chroma and ≤0.05 lightness — imperceptible in light mode.

This is not cosmetic tidying. A raw `oklch(...)` in a class does not remap under `.dark`, so
left alone these two badges would be the only elements in the app that keep a near-white
background in dark mode — a defect that surfaces at step 9 and reads as a palette bug rather
than a `constants.ts` one. Fixing it here, on tokens dark mode already has to author, costs
nothing extra at step 3.

The consequence to state plainly: **step 2's diff is no longer strictly zero.** Five entries
in `PRIORITY_STYLES` change class strings for a sub-perceptual colour shift. The gate becomes
"no visual change except the two priority badges, and even those imperceptibly" — still
checkable, no longer a clean binary.

Remap the sidebar. The current `--color-sidebar-accent` is a saturated teal marking the
**active** nav item, which is shadcn's `sidebar-primary`; their `sidebar-accent` means a
subtle hover. `--color-sidebar-muted` has no equivalent and stays a domain extra.

### 3. Dark mode

Roughly 27 values need authoring — 35 less the eight `sidebar-*`, which are mode-invariant
(see below). Brand, money, and sidebar colours are design work; the
neutrals are **not** the mechanical part they look like, because two of them change meaning
between modes.

**`--border` and `--input` become translucent white overlays in dark**, following shadcn:
`oklch(1 0 0 / 10%)` and `oklch(1 0 0 / 15%)`. Hairlines read consistently over any surface
that way, but the real reason is that Nova's vendored source uses `--input` as a **surface**
in dark, not just a border — `input` ships `dark:bg-input/30 dark:disabled:bg-input/80`, and
`button` outline ships `dark:bg-input/30 dark:hover:bg-input/50`. Today `--color-input` is an
opaque grey used only as a border colour, at three sites in `primitives.tsx`.

Mirroring that opaque value into dark is the natural instinct and it is wrong: `dark:bg-input/30`
would wash every input with 30%-opacity grey and `dark:disabled:bg-input/80` would make
disabled inputs a near-solid slab. The symptom shows up in the components; the cause is in the
token block. Author them with alpha.

The two design constraints:

- **The sidebar is mode-invariant.** All eight `sidebar-*` tokens are authored once in
  `:root` and appear **nowhere** in the `.dark` block — the rail is pixel-identical in both
  modes. This turns "the sidebar must sit lighter than the dark app background, or it
  vanishes" from a design task into a one-line check: dark `--background` must land
  meaningfully below the current `--sidebar` of `oklch(0.22 0.018 235)`. shadcn's own dark
  background is `0.145`, which clears it comfortably. The cost is that dark `--background` is
  now constrained — a lighter charcoal near `0.20` would flatten the rail and force the eight
  tokens back into `.dark` after all.
- `inflow` and `spend` must clear WCAG AA (4.5:1) on dark cards. Colour carries meaning
  here, and it is the **only** channel at most sites: `signed` is passed at just two of the
  fifteen `<Money>` call sites (`transactions-view:263,312`). The other thirteen colour by
  `tone` with no `+`/`−` prefix. The contrast has to carry the whole load.

`layout.tsx:16` hardcodes `viewport.themeColor: "#2b6e63"`, which would leave the browser
chrome teal in dark mode. Use Next's array form, keyed to `prefers-color-scheme`:

```ts
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2b6e63" },
    { media: "(prefers-color-scheme: dark)", color: "<dark sidebar value>" },
  ],
};
```

That follows the OS rather than the `next-themes` choice, so in principle a user who
overrides the theme in-app gets mismatched chrome. **In practice they cannot.** `themeColor`
only paints chrome on mobile browsers; desktop ignores it. Decision 9 gives mobile no toggle,
so on the one platform where the tag renders, `prefers-color-scheme` *is* the theme. Reaching
the mismatch requires the desktop sidebar toggle, where the tag does nothing.

This is a load-bearing consequence of "no mobile toggle" rather than a coincidence. **Adding a
mobile toggle later breaks it**, and the symptom — browser chrome disagreeing with the app on
one platform — would not obviously point back here. At that point switch to driving
`<meta name="theme-color">` from `next-themes` on the client.

Add `suppressHydrationWarning` to `<html>`. Without it `next-themes` throws a hydration
error on every load.

The toggle sits in the sidebar footer beside Sign out. Two states, `defaultTheme="system"`.
Mobile gets no toggle: `MobileNav` is a horizontal strip holding a logo and five icons,
with no room for a sixth. It follows the OS, which is the right default on mobile.

### 4. Component migration

Three homes, and `ui` means exactly one thing:

| Directory | Holds | Example |
|---|---|---|
| `src/components/ui/` | **Vendored registry files only** | `button.tsx`, `dialog.tsx`, `select.tsx` |
| `src/components/` | Hand-written shared composites, no domain knowledge | `confirm-dialog.tsx` |
| `src/app/_components/` | Domain composites — views, forms, widgets | `money.tsx`, `page-header.tsx` |

`src/app/_components/` sits inside the App Router tree, and the underscore marks it private
to routing. Design-system primitives are not route-scoped. Every shadcn doc and registry
item assumes `components/ui`.

**`src/app/_components/ui/` is deleted.** Once `primitives.tsx` and `modal.tsx` go at step 8
it would hold only `money.tsx` — a directory called `ui` containing a domain component, two
levels from the real design system with the same name. `money.tsx` moves up to
`_components/money.tsx`, flat beside `page-header.tsx`, `app-nav.tsx` and `auth-shell.tsx`.
Roughly eight import paths change; step 8 is already rewriting imports.

Keeping `components/ui/` purely vendored is the reason `ConfirmDialog` sits in `components/`
rather than `components/ui/` — a re-`add` should never have to reason about which files in
that directory were hand-written.

| Old | New | Call-site churn |
|---|---|---|
| `Button` | `button` | none — but app-wide density shift |
| `Input`, `Textarea` | `input`, `textarea` | none — same shift |
| `Badge` | `badge` | none |
| `Card` | `card` | **14 sites, restructure** |
| `Field` | `field` family | mechanical rename |
| `Modal` | `dialog` | 4 files, prop reshape |
| `Select` | `select` | **6 sites, API change** |

**Button needs no call-site edits, but is not free.** Only `ghost`, `outline`, `sm`, and
`icon` ever appear explicitly, and Nova has all four; `primary` and `md` are defaults only, so
renaming them to `default` is a no-op in the source. Drop `danger` and `secondary` — nothing
uses them. What it does cost is height: `default` is `h-8` where `md` was `h-10`, so every
button in the app shrinks 8px. That is the density shift, accepted deliberately.

Note Nova's `destructive` is a **tint**, not a fill — `bg-destructive/10 text-destructive`,
where the old `danger` was a solid `bg-spend`. This is what `ConfirmDialog` gets in step 7.

**Card is the sleeper.** Nova's root is
`flex flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) ring-1 ring-foreground/10`,
with horizontal padding living in `CardHeader` / `CardContent` / `CardFooter` (`px-(--card-spacing)`),
not the root. Three shapes to migrate:

| Call sites | Current | Migration |
|---|---|---|
| `p-4`, `p-5` stat/panel cards (6) | own padding, no structure | wrap children in `CardContent`; drop the `p-*` |
| `p-10 text-center` empty states (3) | own padding | `CardContent` plus a spacing override |
| bare table containers (3) | `overflow-hidden`, **no** padding | set `[--card-spacing:0]` — the root reads that var, so it is the clean escape hatch |

`overflow-hidden` is built into Nova's root, so the explicit ones at `transactions-view:203`,
`expenses-view:109`, and `income-view:88` become redundant.

**Select is the real work.** Six usages across `expense-form`, `transaction-form`, and
`transactions-view`, each changing shape:

```
onChange={(e) => setX(e.target.value)}   →  onValueChange={setX}
<option value="x">                        →  <SelectItem value="x">
```

`transactions-view.tsx:171,186` pass `<option value="">` for "All priorities" and "All
frequency". Radix Select rejected empty-string values; Base UI instead makes `null` the
documented "no selection" value. Give each filter a `value={null}` item and map `null` to
`undefined` at the query boundary. No sentinel string.

`field` maps `label` to `FieldLabel`, `hint` to `FieldDescription`, and adds `FieldError`.
The `optional` badge has no equivalent and stays a custom child.

**`combobox` turns the Category field into a constrained dropdown.** Today
`transaction-form.tsx:117-129` is a free-text `<Input list="tx-categories">` over a
`<datalist>` — the only `<datalist>` in the codebase, and not a component at all. Base UI's
`Combobox` is a picker, not an autocomplete: its docs state it "does not allow free-form text
input", and the free-text path is not exposed on the public root. That constraint is the
point. One maintained vocabulary beats "groceries", "Groceries" and "food shop" meaning the
same thing.

**The source list has to change, or the field deadlocks.** `transaction.ts:97-103` currently
serves `SELECT DISTINCT category FROM transaction` — the categories already used. That is a
fine autocomplete source and an impossible dropdown source: a category can only enter the list
by already being on a transaction, so constraining to it means no new category can ever be
chosen, and on an empty database no category at all.

Feed it from the `expense_category` table instead, via `api.category.list` — the maintained
list, matching what `expense-form.tsx:27` already does. `transactions-view.tsx:46` swaps its
query and keeps passing `categories` down as a prop, so the form stays prop-driven per
[adr001](../../docs/adr/adr001-context-providers-for-global-state-only.md).

`category.list` returns full rows — `id, name, expenseCount` and an `expense` join — where the
deleted procedure returned a bare `string[]`. Reuse it and map to names in the view
(`.map((c) => c.name)`), rather than adding a lean `category.names` procedure. `expense_category`
is a handful of rows, so the join costs nothing, and the query is one already written and
cached. The one string attached: the picker now depends on the categories-admin query. That is
a ten-line reversal to a dedicated procedure if that query ever grows expensive or admin-only —
hypothetical on current data.

**The combobox stores a name, exactly as the input does today.** `transactions.category` stays
plain text and the schema does not change.

Two consequences:

- **Editing an old transaction can silently blank its category.** A row may hold a label absent
  from the list, including the `"Uncategorised"` column default. When the current value is not
  in the list, inject it as an item so the dropdown can represent it. Without that, opening such
  a record shows an empty field and saving writes the blank.
- **`transaction.categories` becomes unused.** `transactions-view:46` is its only caller. Delete
  the procedure with the swap rather than leaving it as dead code.

The field changes what it accepts, not what it stores — see
[CONTEXT.md](../../CONTEXT.md), where Expense Category is the single category vocabulary and
governs Transactions too.

### 5. Behaviour fixes

`dialog` replaces `Modal`, which renders its backdrop as a full-screen
`<button aria-label="Close dialog">`. Screen readers announce a giant button covering the
page. Dialog brings a focus trap, focus restore, scroll lock, and a real backdrop.

**This is not a minor diff.** All four form modals change shape at once:

| | `modal.tsx` | Nova `DialogContent` |
| --- | --- | --- |
| Mobile | bottom sheet, `items-end`, `rounded-t-2xl` | centred |
| Desktop width | `sm:max-w-lg` (512px) | `sm:max-w-sm` (384px) |
| Padding | `p-6` | `p-4` |
| Overflow | `max-h-[90vh] overflow-y-auto` | **neither** |

The first three ship as-is, per decision 1. The fourth does not. Nova centres with
`-translate-y-1/2` and sets no max height, so a form taller than the viewport overflows both
edges — and the top half is unreachable, because there is nothing to scroll.
`transaction-form` has seven fields and hits this on a short phone.

Add `max-h-[90vh] overflow-y-auto` to the vendored `DialogContent`. That is not a style
override in the sense decisions 1 and 16 rule out: those govern appearance, and content you
cannot reach is a correctness failure of exactly the kind driver #1 exists to fix. The edit
lands once on a vendored file and does not affect future registry pulls.

`alert-dialog` replaces the four `confirm()` calls at `categories-view:83`,
`expenses-view:180`, `income-view:146`, and `transactions-view:279`. This is not a swap:
`confirm()` blocks, AlertDialog holds state. Each site must track which row is pending
deletion and render the dialog once.

Four near-identical uses justify a shared `ConfirmDialog` composite at
`src/components/confirm-dialog.tsx`, taking `open`, `onOpenChange`, `onConfirm`, `title`, and
`description`. It needs `onOpenChange` as well as `onConfirm` — dismissing via Escape, the
backdrop, or Cancel has to clear the caller's pending-row state, or the next delete opens a
dialog naming the previous row.

**Respect [adr001](../../docs/adr/adr001-context-providers-for-global-state-only.md) here.**
The tempting shape is a promise-based `useConfirm()` hook. The ADR forbids it: page-local
state stays inline with `useState` and passes down as explicit props. A component taking
props is fine; a hook or provider is not.

`sonner` replaces `alert(err.message)` at `categories-view.tsx:20`, with `<Toaster />` in
the root layout. That `alert` is deleted rather than rewritten — the global
`MutationCache.onError` in section 6 covers it, along with the nine other mutation sites.

### 6. Error handling

The four forms currently follow two house styles:

| | category, expense | income, transaction |
|---|---|---|
| Reset on edit | `key` on the parent | `useEffect` from props |
| Cancel button | `variant="outline"` | `variant="ghost"` |

Both reset strategies work; the `key` approach is the idiomatic one.

Error handling does **not** split cleanly along that line. It is three ways, not two:

| | category | expense | income, transaction |
|---|---|---|---|
| Validation errors | inline `<p>` | inline `<p>` | **none at all** |
| Mutation errors | inline `<p>` | **silent** | **silent** |

`category-form` is the only one that wires `onError` (`:38-41`). `expense-form` keeps an
`error` state but sets it solely from client-side checks (`:65,67`), so it reports empty names
and swallows failed writes. The other two do neither.

Target policy for all four:

| Error | Destination |
|---|---|
| Field validation | `FieldError` |
| Mutation failure | Sonner toast |

**The two halves land in different steps, and that ordering matters.** Step 7 wires the
mutation half only. The validation half needs `FieldError`, which needs react-hook-form, which
is the follow-up.

So step 7 **keeps** the inline `<p>` boxes in `category-form` and `expense-form`. Deleting
them there would strip `expense-form`'s validation messages with nothing to replace them until
the follow-up ships — a regression for one form, for an unbounded window. The boxes die in the
react-hook-form change, where `FieldError` takes over the same job in the same commit.

#### The mutation half is one global handler, not ten call sites

The forms are only half the problem. **All four views hold a delete mutation, and three of
them swallow errors too** — `expenses-view:19`, `income-view:17`, `transactions-view:63` pass
only `onSuccess`. Counting those, ten mutation sites need feedback and two have it.

Per-site `onError` would fix today's ten and re-open the hole at the eleventh; the eight
current misses are the evidence. So the toast is wired once, in `createQueryClient`:

```ts
new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, variables, context, mutation) => {
      if (mutation.meta?.skipGlobalError) return;
      toast.error(mutation.meta?.errorMessage ?? error.message);
    },
  }),
})
```

Every mutation gets feedback by default, including ones not yet written. `meta.errorMessage`
customises the copy; `meta.skipGlobalError` opts out. No conflict with
[adr001](../../docs/adr/adr001-context-providers-for-global-state-only.md) — the QueryClient
is a transport client, which it permits as global.

Two constraints on the implementation:

- **Global and per-mutation `onError` both fire**, per-mutation first, and the global one
  cannot be suppressed by an individual mutation except through `meta`. `category-form` is the
  one site with an existing mutation `onError`, so it would show its inline box *and* a toast.
  Fix it by **deleting that `onError`** rather than opting out: its inline box then holds only
  validation messages, matching `expense-form` exactly, and the global handler owns every
  mutation failure uniformly. `categories-view:20`'s `alert` goes the same way.
- `createQueryClient` also runs on the server (`react.tsx:15-17`) for RSC prefetching. Guard
  the toast rather than assuming a browser. Mutations do not run during prefetch, so this is
  belt-and-braces, not a live bug.

`Number(amount) || 0` and its siblings still coerce typos to `0` in all four forms. That
belongs to react-hook-form, not this migration.

## Sequencing

`yarn typecheck`, `yarn run check`, `yarn build`, and `/design-review` are the only gates.
**Nothing here gets a test.** A suite exists but is node-only, and standing up a
component-testing stack is its own decision, not one to make inside a migration.

Accept one consequence knowingly: **6b's category rule is unguarded.** If the "inject the
current value when it is absent from the list" logic is wrong, editing an old transaction
blanks its category on save — and that is invisible to typecheck, lint, build, and a design
review alike. Verify it by hand against a row whose category is not in `expense_category`,
including one holding the `"Uncategorised"` default.

Keep each step small enough to have one obvious cause of failure.

| # | Step | Expected visual diff |
|---|---|---|
| 1 | Init, aliases, pin dependencies | none |
| 2 | Token layer restructure, **light only** | **none**, bar two priority badges (sub-perceptual) |
| 3a | `button`, `input`, `textarea`, `badge` | **app-wide density shift** |
| 3b | `card` + restructure 14 call sites | **app-wide, structural** |
| 4 | `field` | minor — inherits control sizing |
| 5 | `dialog` replaces `Modal` | **4 modals reshape** — width, padding, mobile |
| 6a | `select` — 6 sites, `null` for "no selection" | **intended** |
| 6b | `combobox` — constrained category, source swap, drop `transaction.categories` | **intended** + behaviour |
| 7 | `alert-dialog`, `ConfirmDialog`, `sonner` | **intended** |
| 8 | Delete `primitives.tsx`, `modal.tsx`, and `_components/ui/`; move `money.tsx` | none |
| 9 | Dark mode: values, provider, toggle | new mode |

Dark mode comes last. Authoring 35 values before the components exist means reviewing them
twice. Step 2 establishes only the structure.

Steps 3 and 6 each split in two, for the same reason: the halves fail differently. 3a is a
pure swap whose diff is uniform and easy to eyeball, while 3b touches fourteen files and can
break layout — landing them together makes a broken card indistinguishable from an intended
density change. 6a is a mechanical API swap across six sites; 6b changes what a field *means*,
swaps a query, and deletes a procedure. A regression in 6b is a data problem, not a visual one,
and it would hide behind 6a's expected diff.

Steps 1 and 8 produce zero visual change — a diff there is a bug. Step 2 is all but zero: the
only pixels that move are the two priority badges it tokenises, and even those imperceptibly
(decision 19). Everything else needs real review, and `/design-review` is a live gate at 3a,
3b, 5, 6a, 6b, 7, and 9 rather than a formality. The Card restructure at 3b is the one most
likely to need a second pass; 6b is the one to test against real data rather than by eye.

**Review 3a and 5 on a phone viewport, not just desktop.** Step 5 drops the bottom-sheet
presentation all four form modals use on mobile, and it is the breakpoint where an
unscrollable dialog would show up. Nova's density lands hardest on touch too:
the icon button in the `lg:hidden` mobile header (`app-nav.tsx:115`) goes 36px to 32px, making
it the tightest target in the app. 32px clears WCAG 2.5.8 at AA, so this is a comfort
judgement rather than a compliance one — but it is the evidence that would reopen decision 1,
and it is only visible at that breakpoint.

## Verified 2026-08-11

- **`components.json` records the base library in the `style` key.** Base UI is
  `"style": "base-nova"`; Radix is `"style": "default"` or `"new-york"`. There is no separate
  key. `style` therefore encodes the visual theme *and* the primitive library — so the
  zero-visual-diff claim on steps 3–4 rests on Nova's geometry matching the hand-rolled
  values. Verify per component, do not assume.
- **Base UI `Select` represents "no selection" as `null`, not `""`.** `value` is typed
  `Value[] | Value | null`, and the documented clearable pattern adds an item with
  `value: null`; `<Select.Value>` then exposes `data-placeholder` and renders `placeholder`.
  Step 6 is unblocked — use `null` and map to `undefined` at the query boundary. No sentinel
  string. Whether `""` actually throws is undocumented and now moot.
- **`base-nova` components DO carry inline `dark:` variants.** Token remapping under `.dark`
  is the main mechanism, hooked by `@custom-variant dark (&:is(.dark *))`, but the vendored
  source also hard-codes per-component dark rules — `input` ships
  `dark:bg-input/30 dark:disabled:bg-input/80`, `button` outline ships
  `dark:border-input dark:bg-input/30 dark:hover:bg-input/50`. Step 9 must review the
  vendored components, not just the token block.
- **`base-nova` geometry differs materially from the hand-rolled primitives.** Button
  `default` is `h-8 px-2.5 rounded-lg` against the current `h-10 px-4 rounded-md`; `input` is
  `h-8 bg-transparent rounded-lg` against `h-10 bg-card rounded-md`; the focus ring is
  `ring-3 ring-ring/50` against `ring-2 ring-ring`. Nova's `card` is
  `flex flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) ring-1
  ring-foreground/10` — it owns its padding, where the current `Card` is a bare box and all
  fourteen call sites pass their own `p-*`.
- **Nova's `DialogContent` has no height bound.** Verbatim source is
  `fixed top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2
  gap-4 rounded-xl p-4 sm:max-w-sm` — centred at every breakpoint, with no `max-h` and no
  `overflow`. The current `Modal` is a bottom sheet on mobile (`items-end`, `rounded-t-2xl`),
  512px on desktop, `p-6`, and scrolls at `max-h-[90vh]`. Step 5 changes all four, and the
  overflow one is a defect rather than a restyle — see decision 18.
- **Package is `@base-ui/react` v1.7.0** (2026-08-04). `@base-ui-components/react` is the
  dead pre-v1 name.

## Out of scope

react-hook-form (agreed follow-up), `table`, Recharts, the silent `|| 0` coercion, a
three-state theme toggle, a mobile theme toggle.

**Anything touching category data.** No schema change, no foreign key, no backfill, and no
changes to the rename or delete behaviour in `category.ts`. This is a UI component migration.
The category CRUD gaps are known, pre-existing, and being handled separately.

`table` would restructure the four largest files — 353, 216, 181, and 115 lines — for
cosmetic parity, with no accessibility or behaviour gain.

Recharts would cost more. The bar chart is 48 lines of CSS and renders on the server; the
whole dashboard ships zero client JavaScript. Recharts needs the browser, so adopting it
would force `"use client"` and ship JavaScript where none goes today. Revisit at the second
chart.

## Follow-ups this creates

- **react-hook-form.** Pin `react-hook-form` 7.85.0 and `@hookform/resolvers` 5.7.1. The
  shadcn recipe wires `useForm` and `<Controller />` into `field`.
- **Extract zod schemas.** `transactionInput` is inline and unexported at
  `transaction.ts:25`. Sharing schemas client-side needs them extracted first, into
  `*-schemas.ts` files — `database-migrations.md` reserves `*.schema.ts` for Drizzle tables.
- **`expense_category.name` uniqueness.** Globally unique today. Under the planned
  `householdId`, two households cannot both hold a "Groceries" category, so it needs a
  composite constraint.

## Related ADRs

- [adr008](../../docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md) — Adopt shadcn/ui on Base UI for shared UI primitives
- [adr009](../../docs/adr/adr009-react-hook-form-over-tanstack-form.md) — Use react-hook-form, not @tanstack/react-form
