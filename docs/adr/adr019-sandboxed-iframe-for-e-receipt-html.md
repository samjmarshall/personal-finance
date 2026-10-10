---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-09-23'
# prettier-ignore
---

# Render untrusted e-receipt HTML in a sandboxed iframe over a dedicated CSP-locked route

Technical Story: [Receipt Viewer Dialog design](../../thoughts/designs/2026-09-23-receipt-viewer-dialog.md)

## Context and Problem Statement

A Receipt can arrive as an e-receipt whose body is raw HTML from a third party
(Uber, Amazon, …). We want a Member to open and read that original HTML in the
viewer dialog, alongside image and PDF receipts.

The body is untrusted markup. Our current rule is to never render stored email
markup in the browser: the hardened image route (`GET /api/receipts/[id]/image`)
deliberately refuses to serve `text/html`, which is how it closed a stored-XSS
hole (commit `ca3fbc6`). Rendering an e-receipt reverses that rule. How do we
display untrusted HTML without letting it script our origin, read the session, or
phone home to the sender?

## Decision Drivers

- **Isolation strength** — the markup must not execute script against our origin,
  reach the session cookie/`localStorage`, or navigate our app.
- **Privacy** — e-receipts embed tracking pixels and remote assets; loading them
  leaks the Member's IP and an "opened" signal to the vendor.
- **Keep the image route hardened** — the fix that made the image route refuse
  `text/html` must stay in force; the risky content type must not re-enter it.
- **Maintenance surface** — prefer a browser-enforced boundary over a dependency we
  must track for bypass CVEs.
- **Fidelity** — the receipt should stay readable: inline styles and layout intact.

## Considered Options

1. Sandboxed iframe (`sandbox=""`) fed by a new, dedicated, CSP-locked
   `GET /api/receipts/[id]/html` route.
2. Sanitize with DOMPurify and render the result inline in the app DOM.
3. Do not render HTML — keep the "no image to preview" placeholder, optionally
   offer a raw file download.

## Decision Outcome

Chosen option: "1. Sandboxed iframe over a dedicated CSP-locked route", because it
is the only option that isolates the markup with a browser-enforced boundary
(opaque origin, no `allow-scripts`, no `allow-same-origin`) *and* keeps the
hardened image route out of the HTML business, while a strict `default-src 'none'`
CSP with `img-src data:` neutralizes remote-asset tracking. See the request path
under option 1 below.

### Positive Consequences

- The framed document runs at an opaque origin: no script execution, no access to
  our cookies/DOM, no top-level navigation. Isolation does not depend on us
  out-parsing an attacker.
- Remote images are blocked at the response, so no tracking pixel fires and the
  Member's IP is not leaked to the vendor.
- The hardened image route is untouched — the byte-serving path that refuses
  `text/html` keeps refusing it. The dangerous content type lives only on the new
  route, sandboxed by design.
- The CSP header is a single, testable contract; a route test can pin it exactly.

### Negative Consequences

- First Content-Security-Policy in the app — a new header to reason about and keep
  correct (`style-src 'unsafe-inline'` is required for e-receipt styling; the ADR
  accepts it because no remote channel remains to exfiltrate through).
- A strict sandbox cannot self-measure and the parent cannot read an opaque-origin
  document's height, so there is no auto-height. The frame uses a bounded
  `max-height` with internal scroll.
- Blocking remote images means some receipts render without their hero/logo image.
  Accepted: line items are already extracted, so the picture is a nice-to-have.
- The CSP must repeat `frame-ancestors 'self'` beside the app-wide
  `X-Frame-Options: SAMEORIGIN` (`next.config.ts`). A browser may judge
  `SAMEORIGIN` against the sandbox's opaque origin and refuse to frame the body;
  `frame-ancestors` overrides `X-Frame-Options` where both are set.
- A link click inside the e-receipt navigates the sandboxed frame to the vendor
  page. That page runs no script, but its remote images load and the frame has no
  back button. Accepted, because the Member chose to click. New-tab links would
  need `allow-popups` on both the iframe and the CSP, which loosens this decision.
- The viewer's "Open in new tab" link loads the route top-level, outside the
  iframe. There only the CSP `sandbox` directive keeps the opaque origin and blocks
  script, so it is one lock, not two. Accepted, because a phone needs the room and
  browser zoom to read a wide e-receipt, and remote images stay blocked. A link
  click there navigates the tab, which does have a back button.

## Pros and Cons of the Options

### 1. Sandboxed iframe over a dedicated CSP-locked route

New `GET /api/receipts/[id]/html` serves the stored body only when its content type
is `text/html`/`text/plain`, under a strict CSP, into `<iframe sandbox="">`.

```mermaid
sequenceDiagram
    participant V as ReceiptViewer (parent)
    participant I as iframe (sandbox="", opaque origin)
    participant R as GET /api/receipts/[id]/html
    participant B as Blob store
    V->>I: src=/api/receipts/{id}/html
    I->>R: GET (browser cookie attached)
    R->>R: ReceiptsHttpController session gate → 401 if no session
    R->>R: ReceiptsService.openHtml: blob type is text/* else 404
    R->>B: read by blobPathname
    B-->>R: bytes
    R-->>I: 200 text/html + CSP default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox
    Note over I: no allow-scripts, no allow-same-origin<br/>remote images blocked, cannot script parent
```

| Pros                                                                 | Cons                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| Browser-enforced isolation, not parser-dependent                     | First CSP in the app; a new header to maintain                 |
| Remote images blocked → no tracking pixel, no IP leak                | No iframe auto-height under a strict sandbox; bounded + scroll |
| Image route stays hardened; HTML never re-enters it                  | Some receipts lose their logo/hero image                       |
| CSP + sandbox are two independent locks; CSP is exactly testable     | Extra route + controller/service method to build and test      |

### 2. DOMPurify sanitize + render inline

- Bad, because there is no process/origin isolation — sanitized nodes live in our
  DOM at our origin; a single parser gap is a same-origin XSS.
- Bad, because DOMPurify has a history of bypass CVEs (active in 2024); safety
  depends on us out-parsing attackers forever.
- Bad, because it does not stop tracking pixels or CSS-based exfiltration by
  itself — remote-asset blocking would still be a separate concern.
- Good, because it gives natural in-flow height (no fixed-height iframe).

### 3. Do not render HTML (status quo / download)

- Good, because it keeps the current security posture with zero new surface.
- Bad, because it does not solve the problem — the Member still cannot view the
  original e-receipt in the app.
- Bad, because a raw download hands the untrusted HTML to the OS to open outside
  any sandbox, which is strictly worse than a locked iframe.

## Links

- Design: [Receipt Viewer Dialog](../../thoughts/designs/2026-09-23-receipt-viewer-dialog.md)
- Context: stored-XSS fix that made the image route refuse `text/html` (commit `ca3fbc6`)
