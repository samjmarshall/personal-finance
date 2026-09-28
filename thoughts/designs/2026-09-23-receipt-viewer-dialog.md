# Receipt Viewer Dialog — Design

- **Date**: 2026-09-23
- **Status**: Draft design (pre-implementation)
- **Area**: `/receipts` page, `ReceiptDetail` dialog, receipt blob serving

## Problem

The `/receipts` detail dialog shows extracted data (vendor, total, line items) but
only partially shows the *source* receipt. Images already render inline. PDFs show
an "Open PDF" link. HTML e-receipts show "Arrived by email — no image to preview."

We want a consistent way for a Member to open and view the original receipt —
image, PDF, or HTML e-receipt — from the detail dialog, without weakening the
existing security posture and without leaking one Member's receipts to another.

## Constraints and prior art

- **Private blob store.** Receipt bytes live in a private Vercel Blob store. A bare
  fetch of the blob URL 400s; reads go through the SDK signed with
  `BLOB_READ_WRITE_TOKEN`. (`src/server/blob-store/blob-store.ts`.)
- **Hardened image route.** `GET /api/receipts/[id]/image` gates on the session,
  reads by `blobPathname` (never the member-supplied `blobUrl`), allowlists
  `image/jpeg | image/png | application/pdf`, downgrades anything else to
  `application/octet-stream`, and sets `nosniff` + `private, no-store`. It
  deliberately **refuses to serve `text/html`** — this closed a stored-XSS hole
  (commit `ca3fbc6`). This route stays untouched.
- **Untrusted HTML.** An e-receipt body is untrusted third-party markup. The
  codebase rule to date: stored email markup is never rendered in the browser
  (`buildExtractionContent` note; `SourcePane` placeholder).
- **No Content-Security-Policy today.** `next.config.ts` sets `nosniff`,
  `X-Frame-Options`, `Referrer-Policy`, HSTS, Permissions-Policy — but no CSP.
- **Single household for now.** All authenticated Members belong to the one
  household and may see all household receipts. Household scoping is planned, not
  built (`CONTEXT.md`). The image route reflects this: it checks *authenticated*,
  not *owner*.
- **`<img>` is on record.** ADR018 names `<img src="/api/receipts/[id]/image">` as
  an accepted browser path. `next/image`'s optimizer fetches the source
  server-side without the browser cookie, so it would 401 on this auth-gated route.
  Plain `<img>` stays; do not switch to `next/image`.

### Ruled out during design

- **`next/image`** for receipt images — optimizer drops the cookie → 401. Would need
  `unoptimized`, which gains nothing for a private `no-store` image.
- **react-email / Resend SDK** to render received HTML — react-email only goes
  React element → HTML string. Resend returns raw untrusted `html`/`text`. Neither
  renders or sanitizes inbound HTML.
- **DOMPurify + inline** as the HTML isolation mechanism — no process isolation,
  active 2024 bypass CVEs, and does not block tracking pixels or CSS-based leaks.
  The sandboxed iframe gives browser-enforced isolation a sanitizer cannot match.

## Decisions

1. One unified **`ReceiptViewer`** dialog opens from the detail dialog. It branches
   on content type and renders the right surface: image, PDF, or HTML.
2. **Image + PDF** are served by the existing, unchanged image route.
3. **HTML** is served by a new, dedicated, CSP-locked route and rendered in a
   **sandboxed iframe** (`sandbox=""`). DOMPurify is not used.
4. **Remote images in e-receipts are blocked** by default (CSP `img-src data:`),
   for privacy — no tracking pixels, no IP leak. Line items are already extracted,
   so the picture is a nice-to-have.
5. **Authz**: every receipt-serving route requires a session. No per-Member scoping
   yet. One shared helper carries a `// TODO(households)` marker.
6. **Thumbnails**: image renders a real thumbnail; PDF and HTML use a static icon
   placeholder (PDF live thumbnail deferred). Every thumbnail carries a
   `SquareArrowOutUpRight` overlay as the "open" call to action.
7. The open CTA lives in the **detail dialog only** for now, not the list rows.

## Architecture

### Viewer shell

`ReceiptViewer` (new `src/app/_components/receipts/receipt-viewer.tsx`) is a plain
dialog wrapper. Props: the receipt `id` and `contentType`. It owns the dialog
frame, the loading state, and sizing, and picks a renderer:

- `isPdf(contentType)` → `<iframe src={receiptImageUrl(id)}>` (native browser PDF
  view), bounded height.
- `isText(contentType)` → sandboxed HTML iframe (below).
- otherwise (image) → `<img src={receiptImageUrl(id)}>`, `object-contain`, bounded
  height with scroll.

The detail dialog already carries `contentType`, so no extra fetch is needed to
choose a renderer. Blob bytes load lazily, only when the viewer opens.

### Routes — reuse one, add one

- **Reuse** `GET /api/receipts/[id]/image` unchanged for image + PDF.
- **Add** `GET /api/receipts/[id]/html`. Mirrors the image route's shape (plain
  route handler, its own composition root). It:
  - requires a session (via the shared helper) else 401;
  - 404s a non-integer / missing id;
  - reads the receipt and serves the blob **only if** its stored `contentType` is
    `text/html` or `text/plain`, else 404 — so image/PDF cannot leak through this
    path;
  - reads by `blobPathname`, never `blobUrl`;
  - streams the bytes under the stored text content type with the headers below.

Splitting the routes keeps the hardened image route from ever learning to emit
HTML. The risky content type lives on its own route, sandboxed by design.

#### HTML route response headers

```
Content-Type: text/html; charset=utf-8   (or text/plain per the stored type)
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; sandbox
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Referrer-Policy: no-referrer
```

- `default-src 'none'` blocks scripts, frames, connect, fetch, workers.
- `style-src 'unsafe-inline'` allows the inline styles e-receipts depend on. With no
  remote channel left (no remote img, no connect, no font), CSS-based exfiltration
  has nowhere to send data.
- `img-src data:` blocks remote images (tracking pixels) while allowing embedded
  data-URI images.
- `sandbox` (CSP directive) applies a sandbox to the response itself — a second,
  independent lock beside the iframe attribute.

### HTML iframe

```html
<iframe src="/api/receipts/{id}/html" sandbox="" referrerpolicy="no-referrer" />
```

`sandbox=""` (zero tokens) gives the framed document an **opaque origin**: no
script execution (no `allow-scripts`), no access to our page or origin (no
`allow-same-origin`), no top-level navigation, no popups. Even though we serve it
same-origin, it cannot script our app.

**Sizing.** A strict sandbox cannot self-measure, and the parent cannot read the
opaque-origin document's height, so there is no auto-height. The frame uses a
bounded `max-height` (about `80vh`) with internal scroll.

### Authz

Both routes call one shared helper, e.g.
`requireReceiptAccess(request): Promise<Session | Response>` in
`src/server/receipts/receipt-access.ts`. It returns the session or a 401 Response.
It is the single place that carries:

```ts
// TODO(households): scope receipt reads to the viewer's household once households
// exist. Today every authenticated Member may view all household receipts.
```

When household scoping lands, this one function changes and both routes inherit it.

## Thumbnails and the open CTA

In the detail dialog, the source pane becomes a single clickable **button** — the
preview thumbnail with a `SquareArrowOutUpRight` icon overlaid (top-right). The
whole thumbnail opens the `ReceiptViewer`. The icon signals "click to open" and is
present regardless of whether a live preview can render.

Per type:

- **Image** — real `<img>` thumbnail (as today), with the overlay.
- **PDF** — static PDF icon placeholder + overlay. A live page-1 thumbnail is
  viable via `pdfjs-dist` (~300–400 kb, lazy, plus an install flag to skip a heavy
  native dep) but **deferred**; the full PDF renders in the viewer with no new deps.
- **HTML / text** — static Mail icon placeholder + overlay. A live shrunk HTML
  preview is technically possible (scaled sandboxed iframe) but not worth it: each
  iframe is a full renderer, tracking pixels fire, and email height is
  unpredictable.

**Fallbacks.** If an image or PDF thumbnail fails to load, drop to the type icon —
never a broken image.

**Accessibility.** The thumbnail button gets a real label ("Open full receipt");
the overlay icon is `aria-hidden`. Add the `focus-visible` ring the prior design
review flagged as missing on the list thumbnail button.

**State (adr001).** The "which receipt is open in the viewer" state is local
`useState` in `ReceiptDetail`, passed to `ReceiptViewer` as explicit props — no
Context, no custom hook.

## UI states

- **Loading** — spinner while the blob/frame loads.
- **Image / PDF / HTML** — as above, each bounded with internal scroll.
- **Error** — route 404 or load failure → "Couldn't load this receipt," not a
  broken frame.

## Testing

Colocated, offline, per the unit-testing rule.

- **`html/route.test.ts`** — mock the tiers; assert the root's job: 401 without a
  session, 404 for a non-integer id and for a receipt whose stored type is not
  text, and a 200 that pins the exact `Content-Security-Policy` header (including
  `img-src data:`), `nosniff`, and `private, no-store`. Reads by `blobPathname`.
- **`receipt-viewer` component test** — branches by content type to the right
  renderer; the HTML frame's `sandbox` grants neither `allow-scripts` nor
  `allow-same-origin` and carries `referrerpolicy="no-referrer"`; loading and error
  states render.
- **`receipt-access` helper test** — session present → passes; absent → 401
  Response; the household TODO marker is present.

## Validation spike (small)

The iframe approach is chosen, so the only real in-browser proof needed is a real
forwarded e-receipt (e.g. Uber/Amazon):

- it renders and is readable;
- scripts are inert (no execution, no console access to the parent);
- remote images are blocked (CSP), no tracking pixel fires;
- bounded height + internal scroll behaves;
- logged-out `GET /api/receipts/[id]/html` → 401; logged-in → renders.

This needs a real HTML receipt in the DB, so it is a human-in-the-loop check (same
caveat as the Stage-6 Phase-4 validation).

## Files

- **New** `src/app/api/receipts/[id]/html/route.ts` — CSP-locked HTML serving route.
- **New** `src/server/receipts/receipt-access.ts` — shared session gate + household
  TODO.
- **New** `src/app/_components/receipts/receipt-viewer.tsx` — unified viewer dialog.
- **Modify** `src/app/_components/receipts/receipt-detail.tsx` — source pane becomes
  the clickable thumbnail + overlay CTA; owns viewer-open state; opens
  `ReceiptViewer`.
- **Modify** `src/app/api/receipts/[id]/image/route.ts` — optional: adopt the shared
  `requireReceiptAccess` helper (behavior unchanged).
- **Unchanged** `src/lib/utils.ts` — `isPdf` / `isText` already exist.

## Related ADRs

- [adr019 — Render untrusted e-receipt HTML in a sandboxed iframe over a dedicated CSP-locked route](../../docs/adr/adr019-sandboxed-iframe-for-e-receipt-html.md)
