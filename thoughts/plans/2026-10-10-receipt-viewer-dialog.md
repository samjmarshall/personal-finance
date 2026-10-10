---
date: 2026-10-10
design: thoughts/designs/2026-09-23-receipt-viewer-dialog.md
adrs: [adr019]
status: Ready for Review - Phase 1 of 4
---
# Receipt Viewer Dialog Implementation Plan

## Context
The receipt detail dialog shows the extracted data. It only partly shows the original receipt:
- an image shows inline;
- a PDF shows an "Open PDF" link;
- an e-receipt shows "Arrived by email — no image to preview".

A Member should be able to open the original receipt from the detail dialog, whether it is an image, a PDF or an HTML e-receipt, without weakening today's security posture. adr019 picks how untrusted e-receipt HTML is shown: a sandboxed iframe fed by a dedicated, CSP-locked route. This plan also adds React component tests (React Testing Library on jsdom) to the repo for the first time.

## Current State
The design predates the tRPC 3-tier refactor, so several of its paths and helpers are stale. This section is the source of truth.

- **Image route is a thin composition root.** `src/app/api/receipts/[id]/image/route.ts:8-27` builds `ReceiptsHttpController` in a `compose()` memo and calls `compose().image(request, id)`.
- **The controller owns the session gate, the id parse and the headers.**
  - `ReceiptsHttpController.image` is at `src/server/receipts/receipts.http.controller.ts:91-117`.
  - It reads the session through the injected `SessionReader` (`:92-95`; port at `src/server/auth/session-reader.ts:4-13`) and returns a 401 with body "Unauthorized".
  - `parseReceiptId` is at `:26-30`. `notFound` is at `:65`. `NotFoundError` maps to 404 at `:113`.
  - The image response headers are set at `:102-111`.
- **The service picks what may be served.**
  - `ReceiptsService.openImage` (`src/server/receipts/receipts.service.ts:231-242`) reads by `blobPathname` through `blobStore.stream`.
  - It downgrades anything not on `RENDERABLE_TYPES` (`:36-40`) to `application/octet-stream`, so the image route never emits `text/html`.
  - The service's blob dep is `Pick<BlobStore, "delete" | "stream">` (`:80`, `:94`). `StreamedBlob` is at `src/server/blob-store/blob-store.ts:10-13`, and `stream` is at `:23`.
- **The design's `requireReceiptAccess` / `receipt-access.ts` was dropped** in step 7 (`thoughts/plans/2026-10-07-trpc-3-tier-step-7-receipts.md:177`). The gate stays in the HTTP controller (`.claude/rules/server-architecture.md`, tier map, `*.controller.ts` row).
- **Media helpers.** `isPdf` / `isText` no longer exist (removed in commit `cd90fa7`). Use these from `src/domain/receipts/receipt-media.ts` (barrel at `src/domain/receipts/index.ts:25,55`):
  - `receiptImageUrl(id)` (`:5-7`)
  - `receiptMediaKind(contentType)`, which returns `"image" | "pdf" | "text" | null` (`:21-25`)
- **How e-receipt bodies are stored.** They are written as strings typed `text/html` or `text/plain` (`src/server/email/email.service.ts:205-226`).
- **Detail dialog (`src/app/(dashboard)/receipts/_components/receipt-detail.tsx`).**
  - The local `SourcePane` (`:62-109`) is rendered inside an `overflow-hidden` wrapper at `:337-344`.
  - The dialog root is at `:304`. Its id-freezing ref is at `:255`.
  - The open state is owned by `ReceiptsView` (`receipts-view.tsx:81`).
  - A focus-ring class set to copy is at `receipt-detail.tsx:207`.
- **List view (`receipts-view.tsx`).**
  - The thumbnail button at `:166-185` has no focus ring (`:168`). An earlier design review flagged this (`thoughts/plans/2026-09-07-expense-linking-stage-6.md:307`).
  - Its `previewIcon` (`:68-76`) duplicates the kind-to-icon decision that `SourcePane` also makes.
- **Headers.** `next.config.ts:15-22` sets `X-Frame-Options: SAMEORIGIN` on every path. There is no CSP anywhere in the app.
- **Tests.**
  - `vitest.config.ts` runs only `src/**/*.test.ts` under `environment: "node"`.
  - There is no React Testing Library or DOM environment.
  - `.claude/rules/unit-testing.md:2-4` covers `*.test.ts` only.
  - Probe (2026-10-10): with tsconfig `jsx: "react-jsx"`, Vite 8's Oxc compiles `.tsx` under Vitest 4.1 with no `@vitejs/plugin-react`.
- **Data available for testing.** No HTML receipt exists in the DB. The only writer is the Svix-signed inbound webhook (`thoughts/plans/2026-09-07-expense-linking-stage-6.md:330-348`).
  - Stale as of Phase 1 (2026-10-10): the branch DB, inherited from production, holds 68 `text/html` email receipts (ids 1–68) and no image or PDF rows. Phase 4 can use an existing row instead of a new forward.

## Desired End State
- `GET /api/receipts/[id]/html` returns:
  - **401** with no session;
  - **404** for a bad id, a missing row, a missing blob, or a blob whose type is not `text/html` / `text/plain`;
  - **200** otherwise, streaming the body with these exact headers:
    ```
    Content-Type: text/html; charset=utf-8          (text/plain; charset=utf-8 for plain bodies)
    Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox
    X-Content-Type-Options: nosniff
    Cache-Control: private, no-store
    Referrer-Policy: no-referrer
    ```
- `GET /api/receipts/[id]/image` behaves exactly as before. It still never emits `text/html`.
- In the detail dialog, the source pane is a button labelled "Open full receipt" with a `SquareArrowOutUpRight` icon over it.
  - Image receipts show a real thumbnail. If it fails to load, it falls back to the type icon.
  - PDF and email receipts show a static icon.
  - An unknown type shows "No preview" and no button.
- The button opens a nested `ReceiptViewer` dialog:
  - image → `<img>`;
  - PDF → `<iframe>` of the image route;
  - email → `<iframe sandbox="" referrerpolicy="no-referrer">` of the html route.
  - Each view has a bounded height with internal scroll and a loading spinner. Only an image can show an in-app error ("Couldn't load this receipt.").
- The list thumbnail button shows a visible focus ring.
- `make test` runs node unit tests and jsdom component tests (`*.test.tsx`) in one command.
- adr019 is **Accepted** after a live check with a real forwarded e-receipt.

## Out of Scope
- Scoping receipts per Member or household. Only the `TODO(households)` marker is added.
- A live PDF thumbnail (`pdfjs-dist`) and a live HTML thumbnail.
- An open CTA in the list rows. The list still opens the detail dialog.
- Remote images inside e-receipts. They are blocked by design (adr019).
- An app-wide CSP. The CSP here applies only to the html route.
- Echoing `x-trace-id` on the GET receipt routes. The image route doesn't either (adr020).
- Component tests for components that call `api.*` hooks (`ReceiptDetail`, `ReceiptsView`). These need a tRPC test provider. Their wiring is checked by `/design-review` and the browser checks.
- Playwright e2e for the viewer.
- Branch-prefixed blob pathnames (`thoughts/plans/2026-10-08-blob-branch-prefix.md`). The new route reads the stored `blobPathname` as-is, so it works either way.

## Approach
Build the server half first, mirroring the image path tier by tier:
- a new `ReceiptsService.openHtml` holds the "text only" rule;
- a new `ReceiptsHttpController.html` holds the gate and the CSP headers;
- a new thin `html/route.ts` composition root wires them.

The image and html methods share one private session gate, and that gate carries the `TODO(households)` marker. Next, add the RTL + jsdom harness as its own phase, proven by a smoke test on an existing component. Then build the viewer and the thumbnail as props-only components with colocated component tests, wire them into `ReceiptDetail`, and move the shared `previewIcon` next to them. Finally, a human checks the HTML path end to end on a preview with a real e-receipt, then accepts adr019. Phases 1 and 3 follow the TDD vertical-slice loop (`tdd` skill): one test, then one implementation, in the order listed.

## Phase 1: CSP-locked HTML route
### Changes
- **Characterization first:** `src/server/receipts/receipts.http.controller.ts`, refactor only. Run the existing `image` tests (`receipts.http.controller.test.ts:93-184`) before and after, unchanged.
  - Add `const unauthorized = () => new Response("Unauthorized", { status: 401 });` beside `notFound` (`:65`).
  - Extract the session check at `:92-95` into `private async signedIn(request: Request): Promise<boolean>`. It carries:
    ```ts
    // TODO(households): scope receipt reads to the viewer's household once households
    // exist. Today every signed-in Member may view every receipt.
    ```
  - `image()` calls `signedIn` and returns `unauthorized()`. The behaviour does not change.
- `src/server/receipts/receipts.service.ts`:
  - Add `export type ReceiptHtml = StreamedBlob;` beside `ReceiptImage` (`:56`).
  - Add `openHtml(id: number): Promise<ReceiptHtml>` after `openImage` (`:231-242`). It:
    - throws `NotFoundError(NOT_FOUND_MESSAGE)` when `repository.findBlobPathname` gives `undefined`;
    - throws `NotFoundError("Receipt body not found.")` when `blobStore.stream` returns `null`;
    - otherwise, when `receiptMediaKind(blob.contentType) !== "text"`, calls `await blob.stream.cancel()` and throws the same `NotFoundError`. This means an image or PDF never leaves through this route;
    - returns `{ stream, contentType: \`${bareMediaType(blob.contentType)}; charset=utf-8\` }`.
  - It checks the blob's own type, as `openImage` does. That is the type the bytes stream back under. For email rows the DB column is written from the same value (`email.service.ts:213-226`).
  - Add a comment saying the image route refuses text and this route accepts only text (adr019).
- `src/server/receipts/receipts.service.test.ts`: add `describe("openHtml")` after `openImage` (`:620`), using the `serviceWith` / `recorder` fakes. Cases:
  - reads by pathname;
  - `text/html` maps to `text/html; charset=utf-8`;
  - `text/plain` maps to `text/plain; charset=utf-8`;
  - `text/html; charset=ISO-8859-1` maps to `text/html; charset=utf-8`;
  - missing row: `NotFoundError` "Receipt not found.";
  - null stream: `NotFoundError` "Receipt body not found.";
  - an `it.each` over `image/png`, `application/pdf`, `image/svg+xml` and `application/octet-stream`: `NotFoundError`, with the stream cancelled.
- `src/server/receipts/receipts.http.controller.ts`:
  - Add a module constant `HTML_CSP` holding the exact policy from Desired End State. Give it a short comment per directive:
    - `default-src 'none'` blocks script, connect, frames, fonts;
    - `style-src 'unsafe-inline'` keeps e-receipt styling;
    - `img-src data:` blocks tracking pixels;
    - `frame-ancestors 'self'` overrides the app-wide `X-Frame-Options: SAMEORIGIN` (`next.config.ts:22`). Browsers may judge that header against the sandbox's opaque origin and refuse the frame;
    - `sandbox` adds a second lock beside the iframe attribute.
  - Add `async html(request: Request, rawId: string): Promise<Response>`. Its flow:
    - `signedIn`, else 401;
    - `parseReceiptId`, else 404;
    - `service.openHtml(id)`, with `NotFoundError` mapped to 404 and anything else rethrown;
    - on success, `new Response(body.stream, { headers })` with the five headers from Desired End State.
  - Update the class doc (`:73-77`) to say it also serves the sandboxed e-receipt body.
- `src/server/receipts/receipts.http.controller.test.ts`: add `openHtml` to `harness()` (`:63-91`). Add `describe("html")` with:
  - signed out: 401 "Unauthorized", and `openHtml` not called;
  - the session reader gets the request headers;
  - the bad-id `it.each` table, reused from `:119-138`: 404 and not called;
  - a good id calls `openHtml(n)`;
  - `NotFoundError`: 404 "Not found";
  - another error is rethrown;
  - 200 that pins each header **exactly**, including the full CSP string, and streams the body bytes.
- **New** `src/app/api/receipts/[id]/html/route.ts`: a composition root that mirrors `image/route.ts:1-27`.
  - It builds `new ReceiptsHttpController({ service: receiptsService, sessions: new BetterAuthSessionReader(), logger: createRootLogger().with({ domain: "receipts", component: "html-route" }) })` in a `compose()` memo.
  - `GET` returns `compose().html(request, (await ctx.params).id)`.
- **New** `src/app/api/receipts/[id]/html/route.test.ts`: mirror `image/route.test.ts:1-65`. Assert:
  - the controller is constructed once with the deps;
  - the logger is tagged `html-route`;
  - `html` is called with each id.
- `src/domain/receipts/receipt-media.ts`:
  - Add `receiptHtmlUrl(id)`, which returns `/api/receipts/${id}/html`, below `receiptImageUrl` (`:5-7`).
  - Its comment names the sandboxed route (adr019).
  - Export it from `src/domain/receipts/index.ts` (`:25`, `:55`).
- `src/domain/receipts/receipt-media.test.ts`: add `describe("receipt URLs")` that pins `receiptImageUrl(7)` and `receiptHtmlUrl(7)`.
- `docs/adr/adr019-sandboxed-iframe-for-e-receipt-html.md`: implements this decision (route and CSP). Bring the text up to date with what is built:
  - `:92` → `R->>R: ReceiptsHttpController session gate → 401 if no session`;
  - `:93` → `ReceiptsService.openHtml: blob type is text/* else 404`;
  - `:96` → the full CSP, including `frame-ancestors 'self'`;
  - add a Negative Consequence explaining why `frame-ancestors 'self'` is needed beside the global XFO;
  - `:105` → "Extra route + controller/service method to build and test".
  - The status stays Proposed until Phase 4.

### Success
- [x] `make check` passes
- [x] `make test` passes, including `src/server/architecture.test.ts`. The route imports no `db`, `drizzle-orm` or schema.
- [x] Image controller tests `:93-184` pass unchanged after the `signedIn` extraction
- [x] Signed out, `curl -sk -o /dev/null -w '%{http_code}' https://<branch>.personal-finance.localhost/api/receipts/1/html` prints `401` (a branch in the main worktree serves on `personal-finance.localhost`, with no prefix)
- [x] Signed in on the branch dev server, `/api/receipts/<an image receipt id>/html` returns 404 "Not found". The branch DB has no image or PDF rows (68 `text/html` email rows), so per the user's decision the unit tests cover this (`openHtml` `it.each` over image, pdf, svg and octet-stream). The live checks show: a missing id and a bad id each give 404; id 68 gives 200 with all five headers exactly as in Desired End State; `/68/image` still serves `application/octet-stream`.
- [x] `/security-review` on the new route, `openHtml` and the CSP: no findings

**Pulled forward from Phase 4 (user approved):** the live check showed `Referrer-Policy: strict-origin-when-cross-origin` on the html route. Config headers override the ones a route sets. The path-scoped `next.config.ts` entry is now in. After the change, the html route sends `no-referrer`, and `/image` and `/receipts` keep `strict-origin-when-cross-origin`. `/security-review` on this change: no findings.

## Phase 2: Component test harness (React Testing Library + jsdom)
### Changes
- `package.json`: run `pnpm add -D @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom jsdom`. These are, at the time of writing:
  - RTL 16.3 (peer `@testing-library/dom` ^10);
  - user-event 14.6;
  - jest-dom 7.0;
  - jsdom 30.1 (Node `^24.15.0`; `.nvmrc` is `v24`, local 24.20).

  No `@vitejs/plugin-react`, and no `vite-tsconfig-paths` (`resolve.tsconfigPaths` already covers it).
- `vitest.config.ts`: split into two inline `test.projects`. This is Vitest 4's replacement for `environmentMatchGlobs`.
  - Keep `resolve`, `env` and `unstubEnvs` at the root, with their comments. Move `include` into each project, because a project's `include` replaces the root one.
  - Project 1: `{ extends: true, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] } }`
  - Project 2: `{ extends: true, test: { name: "component", environment: "jsdom", include: ["src/**/*.test.tsx"], setupFiles: ["./src/test/setup-dom.ts"] } }`
  - Keep the `src/`-scope comment about `.claude/skills/**`.
- **New** `src/test/setup-dom.ts`:
  - `import "@testing-library/jest-dom/vitest";` adds the matchers and their types. The file is inside tsconfig `include`, so `tsc` sees the augmentation.
  - `afterEach(cleanup)`, with a comment: RTL auto-cleans only when Vitest `globals` is on, and it is off here.
- **New** `src/components/money.test.tsx`: a smoke test that proves the harness. It renders `Money` (`src/components/money.tsx`) and asserts:
  - the formatted text: `formatCurrency(12.5)`;
  - the `"ledger"` tone class (`text-spend` for a positive value, `text-positive` for a negative one);
  - the `signed` prefix (`+` for negative).
- `.claude/rules/unit-testing.md`:
  - Frontmatter `paths` adds `src/**/*.test.tsx`.
  - The collect sentence names both globs.
  - Add a **Component tests** section:
    - `foo.tsx` pairs with `foo.test.tsx` in the same folder. It runs in the `component` (jsdom) project automatically.
    - Query the way a Member perceives the UI: by role, label or text. Never by class name. Use a test id only when no role exists.
    - Use `userEvent.setup()` for interaction.
    - jsdom loads no subresources, so drive `<img>` / `<iframe>` with `fireEvent.load` / `fireEvent.error`.
    - Base UI dialogs portal into `document.body`, so query through `screen`, not the render container.
    - Test props-driven components. A component that calls `api.*` hooks is covered through its props-driven children until a tRPC test provider exists.
    - jsdom shims live in `src/test/setup-dom.ts`. Add one only when a failing test proves it is needed, each with a one-line reason.

### Success
- [ ] `make check` passes
- [ ] `make test` passes. The output lists both the `unit` and `component` projects, and the existing `*.test.ts` count is unchanged.
- [ ] `src/components/money.test.tsx` fails when the `ledger` tone branch in `money.tsx` is broken on purpose, then passes when it is restored

## Phase 3: ReceiptViewer dialog and source thumbnail
### Changes
- **New** `src/app/(dashboard)/receipts/_components/receipt-source-thumbnail.tsx` (`"use client"`):
  - Move `previewIcon` here from `receipts-view.tsx:68-76` and export it. Keep its comment, and keep its rule (pdf → `FileText`, text → `Mail`, otherwise `null`).
  - Export `ReceiptSourceThumbnail({ contentType, src, vendor, onOpen })`.
    - When `receiptMediaKind(contentType)` is `null`: render a static `h-48` placeholder with "No preview" and **no button**. This replaces today's broken `<img>`.
    - Otherwise: render `<button type="button" aria-label="Open full receipt" onClick={onOpen}>`. The button owns the frame classes, which move here from the `receipt-detail.tsx:338` wrapper so the ring isn't clipped. It also gets the focus-ring set from `receipt-detail.tsx:207` and `relative`.
    - Inside the button:
      - image: an `<img alt="" loading="lazy">`, with the same `biome-ignore lint/performance/noImgElement` comment as `receipt-detail.tsx:101`. A local `useState` failure flag swaps it for an `ImageIcon` placeholder `onError`;
      - pdf: `FileText` + "PDF receipt";
      - text: `Mail` + "Email receipt";
      - every kind: a `SquareArrowOutUpRight` overlay (`aria-hidden`, absolute, top-right).
- **New** `src/app/(dashboard)/receipts/_components/receipt-source-thumbnail.test.tsx`:
  - image: the "Open full receipt" button holds an img whose src is `/api/receipts/7/image`, and a click calls `onOpen` once;
  - `fireEvent.error(img)`: the img is gone and the button remains;
  - pdf and text each show a button with "PDF receipt" / "Email receipt" and no img;
  - `null` and `image/gif`: no button, "No preview" shown;
  - the overlay icon is `aria-hidden`;
  - `user.tab()` focuses the button.
- **New** `src/app/(dashboard)/receipts/_components/receipt-viewer.tsx` (`"use client"`):
  - Props: `{ receiptId: number; contentType: string | null; title: string; open: boolean; onOpenChange: (open: boolean) => void }`.
  - Renders `Dialog` / `DialogContent className="sm:max-w-5xl"` / `DialogHeader` / `DialogTitle` from `~/components/ui/dialog` (adr008).
  - Description by kind: "Original image", "Original PDF", or "Original email. Remote images and scripts are blocked."
  - The body is a child `ViewerSurface` keyed by `receiptId`, so its `loaded` / `failed` `useState` resets for each receipt (adr001: local state, no hook or Context). It renders by `receiptMediaKind`:
    - image: `<img src={receiptImageUrl(id)} alt={\`Receipt from ${title}\`}>` with `max-h-[75dvh] w-full object-contain` inside an `overflow-auto` box. It uses `onLoad` / `onError` and the same biome-ignore comment;
    - pdf: `<iframe src={receiptImageUrl(id)} title="Receipt PDF" className="h-[75dvh] w-full">` with `onLoad`. It is not sandboxed: Chrome's PDF viewer won't run in a sandboxed frame, and this is the same bytes and route the "Open PDF" link already opens top-level;
    - text: `<iframe src={receiptHtmlUrl(id)} sandbox="" referrerPolicy="no-referrer" title="Emailed receipt" className="h-[75dvh] w-full bg-white">` with `onLoad`. It uses a white background because e-receipts assume one in dark mode. A comment cites adr019: there are no tokens, so it gets an opaque origin, no script and no top navigation;
    - `null`: the error alert.
  - Loading: an overlay that copies `receipt-detail.tsx:315-322` (`role="status"`, `aria-label="Loading receipt"`, `Loader2Icon`) until load or error.
  - Error (image only): `<p role="alert">Couldn't load this receipt.</p>`, styled like `receipt-detail.tsx:497-507`.
  - Comment: an iframe can't expose its HTTP status, so a 404 for a PDF or email body shows as plain "Not found" inside the frame.
- **New** `src/app/(dashboard)/receipts/_components/receipt-viewer.test.tsx`:
  - `open={false}`: no dialog;
  - image: the dialog is named by `title`, the img src is `/api/receipts/7/image`, and the "Loading receipt" status shows until `fireEvent.load`;
  - `fireEvent.error`: the alert "Couldn't load this receipt.", with no img and no status;
  - pdf: the "Receipt PDF" iframe has src `/api/receipts/7/image` and no `sandbox` attribute;
  - text: the "Emailed receipt" iframe has src `/api/receipts/7/html`, `getAttribute("sandbox") === ""` (so no `allow-scripts` and no `allow-same-origin`), and `referrerpolicy` is `no-referrer`. Load hides the status;
  - the Close button calls `onOpenChange(false)`;
  - a rerender with `receiptId` 8 shows the status again.
  - If Base UI needs a jsdom shim (for example `Element.prototype.getAnimations`), add it to `src/test/setup-dom.ts` per the Phase 2 rule.
- `src/app/(dashboard)/receipts/_components/receipt-detail.tsx`:
  - Delete `SourcePane` (`:62-109`) and its "never rendered as markup" comment, which adr019 supersedes. Drop the imports it no longer needs.
  - Add `const [viewerOpen, setViewerOpen] = useState(false);`.
  - The `Dialog` at `:304` gets `onOpenChange={(next) => { if (!next) setViewerOpen(false); onOpenChange(next); }}`, so a reopened detail never starts with the viewer open.
  - Replace the wrapper and `SourcePane` at `:337-344` with:
    - `<ReceiptSourceThumbnail contentType={data.contentType} onOpen={() => setViewerOpen(true)} src={imageSrc} vendor={data.vendor} />`;
    - `<ReceiptViewer contentType={data.contentType} onOpenChange={setViewerOpen} open={viewerOpen} receiptId={data.id} title={titleFor(data.vendor)} />`, rendered inside the parent `DialogContent`. Base UI then nests it, so Escape closes only the viewer.
- `src/app/(dashboard)/receipts/_components/receipts-view.tsx`:
  - Delete the local `previewIcon` (`:68-76`) and import it from `./receipt-source-thumbnail`.
  - Add `outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` to the thumbnail button (`:168`).
- `docs/adr/adr019-sandboxed-iframe-for-e-receipt-html.md`: implements this decision (the sandboxed iframe). No text change beyond Phase 1.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] On the branch dev server, with rows inherited from production (read-only, no deletes):
  - an image receipt opens the viewer with the full image;
  - a PDF receipt opens in the browser's PDF viewer inside the dialog;
  - each shows the spinner, then the content.
- [ ] Escape closes only the viewer. The detail dialog stays open. Closing and reopening the detail never shows the viewer.
- [ ] Tabbing shows a visible focus ring on the list thumbnail and on the detail thumbnail. The ring is not clipped.
- [ ] `/design-review` on the detail thumbnail and the viewer, at 375px and desktop, in light and dark

## Phase 4: Live e-receipt check and accept adr019
### Changes
- On the branch's Vercel preview, forward a real e-receipt (for example Uber or Amazon) from an allowlisted sender to the inbound address. Wait until it is processed. This needs a human: the Svix-signed webhook is the only writer of HTML receipts.
- `docs/adr/adr019-sandboxed-iframe-for-e-receipt-html.md:2`: set `Status: 'Accepted'` once every box below is ticked.
- ~~Done in Phase 1~~ (the dev check showed the override). Only if the check below shows `Referrer-Policy: strict-origin-when-cross-origin` on the html route: add a path-scoped `{ source: "/api/receipts/:id/html", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }` entry **after** the `/:path*` block in `next.config.ts`. The last match wins (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md:47`). Then run `/security-review` on that change.

### Success
- [ ] The e-receipt opens in the viewer, is readable, and keeps its inline styles. The frame is not refused by `X-Frame-Options`.
- [ ] Scripts are inert. DevTools shows the sandbox blocked script execution, and nothing ran in the parent.
- [ ] Remote images are blocked. The Network tab shows no requests from the frame to vendor hosts, and the Console shows CSP `img-src` violations.
- [ ] The frame keeps its bounded height and scrolls internally
- [ ] The response headers of `/api/receipts/<id>/html` on the preview match Desired End State exactly, including `Referrer-Policy: no-referrer`
- [ ] Signed out (private window), `/api/receipts/<id>/html` gives 401. Signed in, it renders.
- [ ] adr019 Status is `Accepted`

## References
- Design doc: `thoughts/designs/2026-09-23-receipt-viewer-dialog.md` (carries `## Related ADRs`). Its file list and helper names are stale; this plan's Current State supersedes them.
- ADRs:
  - `docs/adr/adr019-sandboxed-iframe-for-e-receipt-html.md` (Proposed): implemented by Phase 1 (route and CSP) and Phase 3 (sandboxed iframe); accepted in Phase 4
  - Composes with these Accepted ADRs:
    - adr001 (local `useState`, no Context);
    - adr004 / adr021 (`receipts.http.controller.ts` holds the gate, the service holds the rules);
    - adr022 (no data access in `route.ts`, enforced by `src/server/architecture.test.ts`);
    - adr008 (Base UI `Dialog`);
    - adr020 (an iframe or img GET is a plain server root).
- Prior plans:
  - `thoughts/plans/2026-10-07-trpc-3-tier-step-7-receipts.md:177` (`requireReceiptAccess` dropped), `:466-535` (image route moved to the controller)
  - `thoughts/plans/2026-09-07-expense-linking-stage-6.md:307` (missing focus ring on the list thumbnail), `:330-348` (an HTML receipt needs a human)
- Related code:
  - `src/server/receipts/receipts.http.controller.ts:91-117`
  - `src/server/receipts/receipts.service.ts:36-40,231-242`
  - `src/domain/receipts/receipt-media.ts:5-25`
  - `src/app/(dashboard)/receipts/_components/receipt-detail.tsx:62-109,304,337-344`
  - `src/app/(dashboard)/receipts/_components/receipts-view.tsx:68-76,166-185`
  - `next.config.ts:15-22`
  - `vitest.config.ts`
- Docs:
  - `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` (RTL setup)
  - Vitest 4.1 `test.projects` (`/vitest-dev/vitest/v4.1.6`, guide/projects.md)
