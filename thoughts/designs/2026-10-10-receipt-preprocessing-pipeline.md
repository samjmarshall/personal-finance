# Receipt preprocessing and checked extraction

Date: 2026-10-10
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr002 (outbox), adr004 (3-tier), adr014 (Bedrock via OIDC), adr015 (PostHog), adr019 (e-receipt HTML)
Supersedes in part: `thoughts/research/receipt-preprocessing-spec.md` (scope cut for one household)

## Problem

Receipt extraction is one Bedrock call to Sonnet 4.6, and nothing checks its answer.

- Claude reads Australian dates month-first (`thoughts/tickets/bug-receipt-date-us-format.md`),
  and no screen lets a Member fix the date.
- No check catches a wrong total. No confidence signal exists.
- Email photos get no cleanup: HEIC fails, and anything over 3.75 MB fails.
- Scanned PDFs probably reach Claude as near-empty text. Bedrock Converse sends only
  the text layer unless citations are on (unconfirmed; Phase 0 tests it).
- No test set exists, so no change can show it helped.

Goal: make extraction reliable and consistent, upgrade to Sonnet 5.5, and measure every
change against a test set of real Receipts.

## Scope decisions

- **One household.** Build for today's volume and keep seams for more. The spec's
  multi-user parts are out: secret inbound addresses, rate limits, the browser
  corner-drag screen, browser/server parity tests and the 150–300 image golden set.
- **The spec doesn't fit this repo.** It assumes Vercel Workflow (we use Inngest),
  secret inbox addresses (we use Allowed Senders) and the direct Claude API (we use
  Bedrock `au.`).
- **OCR checks the answer; it never feeds Claude.** Research found image-only input
  about as accurate as image plus OCR text (arXiv 2603.02789). OCR text as input adds
  cost on every call. OCR earns its place by catching misread digits.
- **Old Receipts stay as they are.** Re-running would replace line items and lose the
  Member's Expense and Category links. The new edit form fixes wrong dates.

## Verified facts

- **Model:** Sonnet 5.5 is on Bedrock as `au.anthropic.claude-sonnet-5-5` (routes to
  ap-southeast-2 and ap-southeast-4). Anthropic list price is $2/$10 per 1M tokens,
  vs $3/$15 for 4.6. The Bedrock price is unverified.
- **Vision:** Sonnet 5.5 is a high-res model, with a 2576px long edge and up to 4784
  visual tokens. Tokens = ⌈w/28⌉ × ⌈h/28⌉. Bedrock caps each image at 5 MB base64.
- **Structured output:** the AWS model card marks structured outputs **unsupported**
  for Sonnet 5.5. A forced `tool_choice` returns 400 on the Anthropic API; Bedrock is
  untested.
- **Breaking changes:** Sonnet 5.5 returns 400 for non-default `temperature`, for
  prefill and for `budget_tokens`. Thinking defaults to adaptive at effort `high`.
- **AI SDK tool loop:** in a multi-step `generateText`, ai@7 does not throw on an
  invalid tool input, `.refine()` failures included. It sends the error back to the
  model on the next step. The invalid call part carries `invalid: true`; whether its
  raw input survives is unconfirmed.
- **PDF on Bedrock:** Converse analyses PDF pages visually only with citations on.
  AWS says citations are incompatible with structured outputs.
- **Cost today:** about $0.005 per Receipt in image tokens and $0.012 in output tokens.
  Output, not pixels, is the larger cost.

## Architecture

All work stays in the `process-receipt` Inngest function, which upload and email
already feed.

```
Blob bytes
  → hash + duplicate check                 (exists; now also matches needs_review)
  → sniff real type from bytes
  → route by kind:
      image   → normalise: HEIC→JPEG, EXIF rotate, fit 2576px long edge,
                JPEG ~90, strip metadata                     → image part
      PDF     → text layer?  yes → text part
                             no  → render ≤3 pages → normalise → image parts
      HTML    → text part                                    (exists)
  → source text (flag `receipt-ocr-check` on):
      image / scanned PDF → Textract DetectDocumentText
      text PDF / HTML     → its own text, free
  → Sonnet 5.5, record_receipt tool, effort low, at most 2 tool calls
      Zod schema = shape + checks (+ source-text check)
  → outcome:
      checks pass              → processed
      checks fail after retry  → needs_review + reviewReasons
      no shape-valid answer    → failed (retry button, as today)
```

- **In-memory normalisation.** No new Blob objects. The browser keeps its HEIC
  conversion and compression; its long-edge cap rises from 2048 to 2576px.
- **One Inngest unit.** A Bedrock retry re-runs Textract for about $0.0015. Splitting
  into `step.run`s would mean storing the normalised image between steps.
- **Time budget.** One `AbortSignal` of about 240s covers the whole `generateText`,
  retry included, inside the route's 300s `maxDuration`.
- **Confidence is the status.** `processed` means every check passed; `needs_review`
  means one failed. Claude never scores itself.

## Components

### Domain (`src/domain/receipts/`, pure)

- `receipt-extraction.dto.ts`: the `record_receipt` tool input schema.
  - **Fields:** `vendor`, `datePrinted` (exactly as printed), `total`, `subtotal`,
    `discounts`, `surcharges`, `currency`, `items[]` (name, price, quantity, categoryId).
  - **Checks:** `.superRefine()` runs `receipt-checks`.
  - **Date:** a transform derives `receiptDate` (ISO) from `datePrinted`.
  - **Factory:** a schema factory takes `{ sourceText?, today }` so refinements can
    see the source text.
- `receipt-checks.ts`:
  - **Date read:** day-first; month-first only when that is the only valid date
    (`10/25/2026`). Month names are read as written.
  - **Items sum:** items + surcharges − discounts ≈ total, within 5c (cash rounding).
    Skipped when there are no items.
  - **Date range:** not in the future and at most 2 years old.
  - **Basics:** total > 0 and vendor not blank.
  - **Reuse:** extend `receipt-total.ts`; don't duplicate it.
- `source-text.ts`: does the total or date appear in the source text? Match money
  forms (`$34.00`, `34.00`) and date forms (`09/10/26`, `9 Oct 2026`).

### Server (`src/server/`)

- `receipts/receipt-media.normalise.ts`:
  - **Sniff:** `file-type`.
  - **HEIC:** `heic-convert`.
  - **Image work:** `sharp` rotates, resizes, encodes and strips metadata, with
    `limitInputPixels` ≈ 50MP and `failOn: 'error'`.
- `receipts/receipt-pdf.ts`: `unpdf` tests the text layer (chars per page plus a money
  pattern), returns the text, or renders up to 3 pages. Page rendering may need a
  canvas package (Phase 0).
- `aws/textract.ts`: `DetectDocumentText` in ap-southeast-2, using the OIDC role
  credentials (`aws/credentials.ts`).
- `feature-flags/`: a thin wrapper over the existing `posthog-node` client. The worker
  reads `receipt-ocr-check` once per Receipt with a short timeout and treats any
  error as off.
- `receipts/receipt-extraction.service.ts`:
  - **Call:** replace `generateObject` with `generateText` + `record_receipt` and
    `stopWhen` at 2 tool calls.
  - **Dependencies:** inject Textract and the flag, as the model is injected today.
  - **Provider options:** set effort low and no `temperature`.

### Terraform (`infrastructure/`)

- **Model:** `locals.tf` switches `bedrock_receipt_model` and `bedrock_foundation_model`
  to Sonnet 5.5.
- **IAM:** the per-environment role policy adds `textract:DetectDocumentText`.
- **Pricing:** `pricing.tf` uses the Sonnet 5.5 Price List model name.
- **Flag:** `posthog.tf` adds the `receipt-ocr-check` flag (provider support unverified).

### UI (`src/app/(dashboard)/receipts/`)

- `needs_review` badge listing its reasons.
- Edit form for vendor, date and total on `needs_review` and `processed` Receipts.
- "Looks right" button that confirms a `needs_review` Receipt without changes.

New packages: `sharp`, `heic-convert`, `file-type`, `unpdf`, `@aws-sdk/client-textract`,
and possibly a canvas package for PDF rendering.

## Data model

One migration:

- `receipt_status` gains `needs_review`.
- `receipt.reviewReasons text[] not null default '{}'`. Codes: `items_total_mismatch`,
  `date_unreadable`, `date_out_of_range`, `total_not_in_source`, `date_not_in_source`.
- `receipt.reviewedAt timestamptz null`: set when a Member saves or confirms. `rawJson`
  keeps Claude's answer and the columns keep the Member's, so the difference becomes a
  free test-set label.
- Subtotal, discounts, surcharges and `datePrinted` live only in `rawJson`.

Status flow:

```
pending      → processed | needs_review | duplicate | failed
needs_review → processed   (edit + save, or "Looks right")
processed    → processed   (edit + save)
failed       → pending     (retry, as today)
```

New tRPC procedures (`receipts.trpc.controller.ts`):

- `receipt.update({ id, vendor, receiptDate, total })` saves the Member's edits.
- `receipt.confirmReview({ id })` confirms without edits.
- Both set `reviewedAt` and clear `reviewReasons`. Checks don't re-run on Member edits;
  the Member is the source of truth.

`findProcessedByHash` must also match `needs_review` rows; otherwise a re-upload pays
for a second extraction.

## Error handling

**Before Claude, at no model cost:**

| Case | Outcome |
|---|---|
| Sniffed type not allowed (zip, HTML posing as an image) | `failed`: unsupported file type |
| Over `limitInputPixels` | `failed`: image too large |
| HEIC conversion or page render throws | `failed`, retryable |
| Encrypted PDF | `failed`: PDF is password-locked |
| Scanned PDF over 3 pages | Process the first 3 and note it on the span |
| Over Bedrock's image cap after normalising | `failed`: too large (existing guard stays) |

**OCR and the flag degrade, never block.** Textract errors continue without the
source-text check and set `ocr_failed` on the span. A failed or slow flag read counts
as off.

**Claude call:**
- **Bedrock errors:** handled as today. Retryable `APICallError`s (429, 5xx, network)
  rethrow for Inngest; 400 and 403 park at once.
- **Text instead of a tool call:** counts as a failed attempt; two of them → `failed`.
- **Output cap:** `maxOutputTokens` stays 8192. Low-effort thinking counts toward it,
  so the eval watches for truncation. A truncated answer stays `failed` ("too many lines").

**Privacy and safety:**
- **Metadata:** normalised images, which Bedrock and Textract see, carry no GPS.
- **Redaction:** OCR text and PDF text get the redaction tag, like image bytes today.
- **Untrusted content:** Receipt and email text stays untrusted. The model can only
  fill `record_receipt`, and the checks gate the result.
- **Region:** Textract runs in ap-southeast-2, matching Bedrock `au.`.
- **Out of scope:** Vercel functions run in `iad1`, so bytes already transit the US.

## Observability

Span attributes on the extraction span go to PostHog: input kind, failed check codes,
tool calls used, OCR used, OCR failed, pages rendered. Check-fail rates come from
PostHog; no new tables.

## Testing

### Test set (`make eval`, outside `make test`)

- **Data:** a gitignored `eval/` folder with 30–40 of the household's own Receipts, each
  with a `label.json` (vendor, date, total, items, kind). Back it up to private Blob
  under `eval/`. Keep it out of git.
- **Coverage:** crumpled thermal, long, app screenshots, born-digital PDFs, scanned PDFs,
  HTML emails, and dates on days 1–12.
- **Labels:** run today's pipeline once for drafts, then the Member corrects them by hand.
- **Runner:** its own Vitest config, calling real Bedrock with `assume` credentials.
  Model, image long edge, OCR mode (off, plain, expense) and effort are parameters.
- **Report** (`eval/reports/<date>-<config>.md`):
  - vendor, date and total accuracy
  - item F1
  - `needs_review` rate and false-alarm rate
  - tokens, cost and latency per Receipt

### Unit tests (`make test`, fake model, synthetic fixtures safe to commit)

- **Date parsing:** `09/10/26`, `10/25/2026`, `9 Oct 2026`, garbage.
- **Total check:** 5c rounding, discounts, surcharges, no items.
- **Source-text matching:** money and date forms.
- **Normalise:** EXIF-rotated photo, HEIC, decompression-bomb PNG, PNG named `.pdf`.
- **PDF:** text layer vs scanned.
- **Tool loop:** pass first try, pass on retry, `needs_review`, no tool call → `failed`,
  Textract down → continues.

## Build order

**Phase 0: spikes and baseline**
1. Push a real scanned PDF through today's code to confirm the bug.
2. Sonnet 5.5 on Bedrock:
   - Is a forced tool (`required` → `any`) accepted, or must we use `auto` plus a
     prompt instruction?
   - Does the raw input of an invalid tool call survive?
   - How do we set effort low (`additionalModelRequestFields`?)?
   - What does `structuredOutputMode: 'auto'` pick?
3. PDF page rendering on Vercel (`unpdf` plus a canvas package, or an alternative).
4. PostHog Terraform provider support for feature flags.
5. Textract `DetectDocumentText` in ap-southeast-2.
6. Bedrock Price List model name and price for Sonnet 5.5.
7. Build the test set, then record a baseline report on today's Sonnet 4.6 code.

**Phase 1: reliability core.** Sonnet 5.5, `record_receipt`, checks, `datePrinted`,
`needs_review`, edit form and "Looks right". Closes the date-bug ticket. Eval vs baseline.

**Phase 2: normalisation.** Server sniff, HEIC, rotate and resize; browser cap 2576px;
HEIC accepted from email; PDF text-layer route and page rendering. Eval 1568px vs 2576px.

**Phase 3: OCR check.** Textract behind `receipt-ocr-check`. Eval OCR off vs plain vs
`AnalyzeExpense` field comparison.

## Later (build on evidence only)

| Item | Trigger |
|---|---|
| Server auto-crop (document detect + warp, fall back to uncropped) | Eval shows cluttered-background photos failing |
| Tiling tall Receipts | Long Receipts still fail at 2576px |
| Escalate a failed Receipt to a stronger model (e.g. Opus) before `needs_review`: one extra call at ~5x cost, still checked | `needs_review` rate stays high and the Member's edits show model misreads, not bad photos |
| Native structured output layered under the tool, keeping the Zod schema as the final gate | Bedrock supports structured outputs for Sonnet 5.5 |
| OCR text sent to Claude as extra input | Eval shows digit misreads that OCR gets right |
| GST and ABN fields (ABN checksum, GST ≤ total ÷ 11) | Tax features |
| Re-run old Receipts, keeping item links | Member demand |
| Line-item editing | Member demand |
| Blur/dark "retake?" gate | Eval shows bad photos driving failures |
| Function region (`iad1` → Sydney) | Data-residency decision |

## Rejected

- **OCR text as model input (hybrid prompt):** no shown accuracy gain, higher cost per call.
- **Bedrock citations for PDFs:** conflicts with structured outputs and would break when
  native structured output arrives.
- **Plain JSON in text:** unreliable in the Member's experience; a structured-output
  tool with Zod validation is the contract.
- **Model self-reported confidence:** poorly calibrated; check-derived status replaces it.
- **Browser detection pipeline (scanic, corner-drag, parity tests):** a lot of work for
  one household, with no measured need.

## ADR Candidates

Run `/domain-model thoughts/designs/2026-10-10-receipt-preprocessing-pipeline.md` to capture these as Proposed ADRs.

- **OCR checks extraction; it never feeds the model.** Why it passes: a reader expects
  OCR-as-input (the exam pattern); we rejected it on evidence and cost, and the flag
  wiring makes it sticky.
- **Extraction contract is a `record_receipt` tool validated by a full Zod schema,
  whose `.refine()` failures drive the in-loop retry; plain JSON is rejected and
  native structured output is a later layer.** Why it passes: lock-in to the tool
  loop, surprising next to `generateObject`, and a real choice among four options.
- **Confidence is the status: checks decide `processed` vs `needs_review`; no model
  score.** Why it passes: it adds an enum value (hard to reverse) and departs from the
  usual confidence-score pattern.
- **The model copies `datePrinted`; code decides day-first.** Why it passes: a reader
  will ask why the date isn't extracted as ISO; the household's day-first locale is a
  constraint the code doesn't show.
- **PDFs route by text layer, and scanned pages render to images; Bedrock citations
  rejected.** Why it passes: a one-line citations flag looks obvious; the Bedrock
  structured-output conflict lives outside the code.
- **Preprocessing runs server-side in the worker; the spec's browser pipeline is
  rejected.** Why it passes: an explicit "no" a future reader would revisit, made for
  one-household scale.

## Terminology TODO

Run `/domain-model thoughts/designs/2026-10-10-receipt-preprocessing-pipeline.md` to persist these to `CONTEXT.md`.

- **Needs review:** a Receipt whose extraction failed a check after one retry, waiting
  for a Member to edit or confirm it. Distinct from failed, where no usable answer
  exists.
- **Source text:** text that checks an extraction, from OCR or from the Receipt's own
  text layer or HTML body. Never model input.
- **Check:** a code rule run over an extraction (items sum, date range, source text).
  Prefer it over "validation", which also names Zod shape parsing.
- **"invoice":** the spec uses it; the glossary lists it under _Avoid_ for Receipt.
  Born-digital PDF Receipts stay Receipts.
