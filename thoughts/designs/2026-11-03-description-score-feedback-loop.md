# Description score feedback loop: answers, Titan telemetry and evals

Date: 2026-11-03
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr004 (3-tier), adr015 (PostHog), adr016 (trace carrier), adr029 (description scores)
Builds on: `thoughts/plans/2026-11-02-adr029-description-scores.md` (PR #126)

## Problem

adr029 scores bank descriptions and adopts on two bars. We can't tell if those bars hold.

- An answer to a Possible duplicate is mostly lost. "Use bank's" and "Both are real"
  delete the row. Only "Keep mine" leaves a `kept` row.
- Only the merged score is saved. The word and meaning scores vanish after scoring.
- The pile, its suggestion, and pick-vs-fill live only in the browser.
- Titan calls send no telemetry. "Embedding unavailable" is one warn log.
- The 577 labelled spike pairs sit on a local, unpushed branch. Nothing re-runs them.

Goal: record every answer, watch the bars and Titan for drift, and grow a reviewed golden
set that gates scoring changes in CI. This lays the eval and observability base for later
AI features.

## Scope decisions

- **Database first, event as a copy.** The database holds every answer. PostHog events
  feed charts and triage. The golden set can always be rebuilt from the database.
- **Humans own labels.** Only a reviewed answer enters the golden set. Bulk-filled
  answers are weak labels and never auto-promote.
- **Evals are tests.** They run in Vitest, not a bespoke harness. The judge here is
  structured output: the scorer's decision against the label.
- **No LLM labelling.** Only the Member knows if two rows are one purchase. An LLM may
  spot cleaning-list gaps; it never sets a label.

## Verified facts

- The repo is **public**, so Actions logs are public. Real descriptions must never reach
  a repo file or CI output.
- Spike pairs: `scripts/spike-description-scores.pairs.json` on local branch
  `spike/adr029-description-scores`, not on `origin`. Fields `id, status, bank, mine,
  same`: 561 same purchase, 15 two purchases, 1 unclear. **Never push that branch.**
- "Keep mine" means "drops the bank's copy" (`import.display.ts`). So:
  `keep_mine`, `use_bank` → same purchase; `both_real` → two purchases.
- PostHog docs (2026-11, undated pages):
  - `$ai_embedding` is a documented manual-capture event. Cost props are optional;
    sent costs take priority.
  - PostHog's cost table doesn't list Bedrock Titan. AWS lists $0.02 per 1M tokens
    (Sydney price unconfirmed).
  - PostHog documents span conversion for `gen_ai.operation.name=embeddings` only, not
    the AI SDK's `ai.embedMany`.
  - Datasets are beta. Items hold `input`, `expected_output`, `metadata`,
    `client_item_id`. Export is a pinned revision as JSONL.
  - Offline evals report through `@posthog/ai/evaluations` (`caseKey`,
    `datasetRevisionId`, per-scorer values) with a personal API key.
  - No `$ai_feedback` or `$ai_metric` event exists. Event names follow
    `category:object_action`, lowercase snake case.
- Titan takes one text per call (`maxEmbeddingsPerCall = 1`). `embedMany` sends 4 at a
  time.
- Vitest 5 already splits `unit` and `component` projects. Workflows run on `push`, so
  fork PRs never get secrets.

## Data model

`possible_duplicate` keeps its row on every answer.

- `status` gains `used_bank` and `both_real` beside `pending` and `kept`. `kept` stays,
  to avoid renaming an enum value.
- Answer columns (null until answered):
  - `answeredAt`
  - `answerMode`: `pick` | `fill`
  - `pile`: `similar_description` | `different_description`. The server computes it from
    the merged score with the pile rule, moved from `import.display.ts` into
    `src/domain/transactions/`. Browser and server share one function.
- Flag-time columns (set by reconcile):
  - `wordScore`, `meaningScore` (null without a meaning score)
  - `scoringVersion`
  - `embeddingModel` (null without a meaning score)
- Label rule: a domain function maps the answer to `samePurchase`.
- `SCORING_VERSION` lives in `description-score.ts`. A test fingerprints the processor
  prefixes, noise words, regex sources and the 3 bars. A change without a bump fails it.
- Reconcile treats answered rows as known, as it does `kept` today. It never refreshes or
  re-flags them.
- "Use bank's" still deletes the *other* pending reviews on that transaction. The app
  decides those, not the Member, so they aren't labels.

Accepted trade-offs:

- Deleting a transaction still cascades its answered rows. Rare; promoted labels survive
  in the dataset.
- No backfill. Old `kept` rows have no mode or version. Charts start at deploy.

## Answer mode

- Each answer in `resolveDuplicatesDto` gains a required `mode: "pick" | "fill"`.
- The page stages `{ choice, mode }`. Fill sets `fill`; a hand change sets `pick`.
- A fill answer is a weak label. Charts split by mode; promotion skips fills.

## Capture helper

`src/server/observability/analytics/`:

- `analytics-events.ts`: a typed map, event name → properties. It starts with
  `bank_sync:possible_duplicate_answer` and `$ai_embedding`.
- `analytics.ts`:
  - `Analytics` port: `capture(name, props)`, typed from the map.
  - `PostHogAnalytics`: distinct id from baggage `member.id`, else `"server"`. Adds the
    deployment environment. Logs a warning on failure and never throws. Sends nothing
    without `POSTHOG_KEY`.
- The `posthog-node` client moves from `errors/posthog.ts` to a shared
  `observability/posthog-client.ts`. Error capture and analytics share it.
  `flushPostHog` and `withFlush` stay as they are.
- Services get `analytics` as a dep, per adr015: no tier imports PostHog.

## Answer event

`TransactionsService` gets `analytics` (wired in `transactions.module.ts`). After each
answer that returns `resolved`, it captures one event. `gone` and `taken` saved nothing
and send nothing. The repository's answer methods return the saved row plus the mine
description, so the service needs no second read.

`bank_sync:possible_duplicate_answer`:

| Group  | Properties                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------- |
| Answer | `review_id`, `answer`, `same_purchase`, `answer_mode`, `pile`, `suggestion`, `followed_suggestion` |
| Scores | `merged_score`, `word_score`, `meaning_score`, `scoring_version`, `embedding_model`             |
| Text   | `bank_description`, `mine_description`, `bank_description_clean`, `mine_description_clean`     |
| Timing | `days_apart`: a gap, not a date. It splits same-day pairs from 1–7 day pairs                   |

Never sent: amount, date, account.

adr015 gets a consequence note: this event and the dataset carry bank and household
description text in PostHog.

## Titan telemetry

`TransactionReconcileService.vectorsFor` captures one `$ai_embedding` per `embedMany`
batch, only when it calls Titan (some texts weren't cached). The service gets `analytics`,
wired in `functions.ts`.

- `$ai_trace_id`: current OTel trace id, linking the import or sync run
- `$ai_span_name`: `transactions.embed_descriptions`
- `$ai_provider`: `bedrock`; `$ai_model`: the env model id
- `$ai_input`: cleaned texts, exactly what Titan sees (adr029)
- `$ai_input_tokens` from `embedMany` usage; `$ai_latency` in seconds
- `$ai_input_cost_usd`, `$ai_total_cost_usd`: tokens × new `BEDROCK_EMBEDDING_TOKEN_PRICE_USD`,
  set through Terraform like the other price vars
- `$ai_is_error`, `$ai_error` on failure. The `embedding unavailable` warn log stays.
- Custom: `cache_hits`, `cache_misses`

Telemetry stays off on `embedMany`. The guard test against Claude-priced `ai.*` spans is
unchanged. Distinct id is the Member for `cdr-import`, `"server"` for the `cdr-sync` cron.

## Dashboard and alert

Dashboard "Bank sync: description scores":

1. Similar pile answered "Both are real": weekly rate, by scoring version and answer mode
2. Different pile answered same purchase: weekly rate
3. Answers by merged score band (0.1 wide), by label
4. Pick vs fill share
5. Titan: error count, p95 latency, weekly cost
6. Cache hit rate per batch

Alert: any `$ai_embedding` with `$ai_is_error` in a day sends an email. A Titan failure is
otherwise silent: meaning scores go null, Adopts stop, reviews pile up. Rate alerts on
answers are left out; at tens a month, one odd week would trip them.

Built with the PostHog MCP during the build. `docs/feature/history-import.md` links them
and drops "Alerts: None yet".

## Golden set

PostHog Dataset `description-scores` (beta):

- `input`: `{ bank_description, mine_description }`, raw, so a cleaning change re-scores
- `expected_output`: `{ same_purchase }`
- `metadata`: `split`, `source` (`spike` | `answer`), `answer_mode`, `scoring_version`,
  `review_id`, `merchant`
- `client_item_id`: `spike-<id>` or `review-<id>`, so a repeat add does nothing

Split: `merchant` is the first word of the cleaned bank description. A hash of it sends
~40% of merchants to `test`, the rest to `tune`. A merchant always lands on one side, so
splits can't leak, and no state is kept.

Seed:

- `scripts/seed-description-dataset.ts`, committed with no data, takes a file path.
- Pipe the spike file in via `git show … > /tmp/…`. Skip the 1 unclear pair.
- Before seeding, the Member re-checks the 15 two-purchase pairs. The spike labelled them
  by rule, and they're the rarest and most valuable.

## Promotion: `/promote-labels`

A Claude Code skill, run on demand (e.g. monthly):

1. Pull answer events newer than the last promoted `review-*` item, via HogQL through the
   PostHog MCP. It never touches the production database.
2. Pick candidates:
   - a pick that went against the suggestion
   - a merged, word or meaning score within 0.1 of its bar
   - a merchant the set hasn't seen
   - Fill answers are skipped.
3. Drop pairs already in the set (same cleaned texts).
4. Show each candidate: descriptions, scores, answer. The Member approves, skips or fixes.
5. Write approved items through the MCP dataset tools.
6. Claude lists cleaning gaps (leftover words that recur in misses) and suggests list
   changes. The Member decides; changes go through code and the eval.
7. Remind the Member to bump the pinned revision in a PR.

## Evals in Vitest

- `vitest.config.ts` gains an `eval` project for `src/**/*.eval.ts`.
- `make test` / `pnpm run test` run `--project unit --project component`, so no secrets
  are needed. `make test_eval` runs `--project eval`.

**No description reaches a test.** A `globalSetup` loads the dataset and runs the real
scorer: `cleanDescription`, word weights (the dataset's own descriptions as corpus, so runs
repeat), Titan vectors in one batch, and the Adopt and pile rules from shared domain
functions. It hands each test only `{ caseKey, split, expected, word, meaning, merged,
adopts, pile }`. A test can't print text it never holds.

`src/domain/transactions/description-score.eval.ts`:

- `it.each(twoPurchase)("$caseKey never Adopts")`, both splits. A two-purchase Adopt
  merges two real purchases, so each one fails loudly.
- Test split, same-purchase group checks: Adopt rate and Similar-pile rate must meet
  floors pinned in the eval file. Floors rise on purpose only. A failure lists the rate,
  the floor, and missed case keys with scores.
- Tune split rates print and never fail.
- Pin `{ datasetId, revisionId }` in `description-score.eval.config.ts`.
  `EVAL_DATASET_REVISION=latest` overrides it.

Reporter `src/test/eval/posthog-reporter.ts`: with `POSTHOG_EVAL_API_KEY` set, it sends
experiment `scoring v{SCORING_VERSION}` against the revision through
`@posthog/ai/evaluations`, with each case's pass or fail and scores. Without the key it
skips the upload.

## CI

New `eval` job in `quality-control.yml`:

- On `push`, `dorny/paths-filter` runs it only when these change: `description-score*`,
  `reconcile-synced.ts`, `src/test/eval/**`, `*.eval.ts`, `vitest.config.ts`.
- Weekly `schedule` on `main` against the latest revision, plus `workflow_dispatch`.
  `schedule` runs from the default branch, so it works only after merge.
- Code-triggered runs use the pinned revision, so red means the code moved. The weekly run
  catches new labels; the Member then bumps the pin (and maybe a floor) in a PR.
- `id-token: write`; assumes `vars.EVAL_ROLE_ARN`.
- Secret `POSTHOG_EVAL_API_KEY`: a personal key scoped to dataset read and eval write,
  apart from the Terraform key.

Terraform `iam.tf`: role `personal-finance-eval`, assumable by GitHub OIDC on this repo,
allowed only `bedrock:InvokeModel` on the Titan ARN. Cost per run is tiny (~1,200 short
texts).

## Error handling

| Failure                              | Behaviour                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Capture fails, or no `POSTHOG_KEY`   | Warn log, no throw. The answer still saves.                                  |
| Same answer sent twice               | `pending` guard saves once. The second returns `gone`, no event.             |
| Titan fails during reconcile         | Error `$ai_embedding` + `embedding unavailable` warn. Cached vectors carry on. |
| Eval can't load dataset or reach Titan | `globalSetup` throws; CI red with "dataset unavailable", unlike a floor fail. Never skips quietly. |
| Reporter upload fails                | Warn only; test result unchanged.                                            |
| Migration                            | Adds enum values and nullable columns; old rows stay valid.                  |

## Testing

- `description-score.test.ts`: version fingerprint, label rule, pile rule
- `transactions.repository.test.ts`: recordingDb snapshots for the answer updates and
  their returned rows
- `transactions.service.test.ts`, fake `analytics`: one event per `resolved`, none for
  `gone`/`taken`; asserts fields and that no amount, date or account key is sent
- `transaction-reconcile.service.test.ts`: event on success and failure, cost math, none
  when all cached, flag-time columns saved; Claude-price guard unchanged
- `analytics.test.ts`: distinct id from baggage or `"server"`, errors swallowed, no-op
  without a key
- `possible-duplicate-piles.test.tsx`: fill sets `fill`, hand change sets `pick`
- Reporter test: payload carries no text
- `architecture.test.ts`: `posthog-node` imported only inside `observability/`

## Build order

1. Shared PostHog client, `Analytics` port, typed event map
2. Keep answered rows, new columns, `SCORING_VERSION`, answer mode end to end
   (migration via `make db_generate` + `make db_migrate`)
3. Answer event
4. `$ai_embedding` + `BEDROCK_EMBEDDING_TOKEN_PRICE_USD` (Terraform)
5. Dashboard and alert (MCP), feature doc, adr015 note
6. Seed script, re-check 15 two-purchase pairs, seed, `/promote-labels`
7. Vitest `eval` project, reporter, CI job, eval IAM role

## Later (build on evidence only)

- **Recommended next step: automated triage (option D).** A scheduled Inngest job runs the
  candidate rules weekly. An LLM judge pre-screens candidates and drafts cleaning-list
  suggestions into a review queue; the Member approves. Build it when monthly candidates
  outgrow one sitting, or when a second AI feature needs the same queue.
- Receipt extraction reuses the capture helper, dataset and Vitest eval project.
- `posthog-js` and household `$groups`, per the 2026-09-15 observability design.

## Rejected

- **Event only** (no database record): a dropped event loses a label for good.
- **Database only**: no charts without hand-written SQL.
- **Guess answer mode on the server**: a pick that agrees with the suggestion looks like a fill.
- **Auto hash or git SHA as scoring version**: unreadable or noisy chart labels.
- **AI SDK telemetry for embeddings**: `ai.embedMany` conversion is undocumented, and the
  span processor prices every `ai.*` span as Claude.
- **Free-form `capture(name, props)`**: names and fields drift across features.
- **Outbox delivery for analytics**: heavy; the database is already the record.
- **PostHog Trace Reviews for promotion**: reviews attach to traces, and an answer isn't one.
- **Auto-promotion**: the poisoning risk this design exists to avoid.
- **Golden set in a repo file**: the repo is public.
- **Local-only eval**: CI must gate scoring changes.
- **Bespoke eval harness**: Vitest already runs input-and-assert tests.
- **Every case strict**: some same-purchase pairs never look alike, so they'd fail forever.
- **Always-latest dataset in CI**: a promotion could turn an unrelated scoring PR red.

## ADR Candidates

Run `/domain-model thoughts/designs/2026-11-03-description-score-feedback-loop.md` to capture these as Proposed ADRs.

- **Answered Possible duplicates are kept as the label record.** Rows outlive the answer;
  PostHog holds a copy. Passes: a data-model change that's hard to undo, a row that looks
  dead to a reader, and real alternatives (event only, database only).
- **Evals run as a Vitest project in CI, with no description text in any test.** Passes:
  surprising without the public-repo constraint, and chosen over a bespoke harness and
  local-only runs.
- **The golden set lives in a PostHog Dataset, rebuildable from the database, promoted
  only by a human.** Passes: beta vendor lock-in, a non-obvious rejection of auto-promotion
  and LLM labelling, and alternatives weighed (own table, repo file).
- adr015 consequence notes, not new ADRs: description text in product events and the
  dataset; `$ai_embedding` sent by hand instead of span conversion.

## Terminology TODO

Run `/domain-model thoughts/designs/2026-11-03-description-score-feedback-loop.md` to persist these to `CONTEXT.md`.

- **Answer**: a Member's decision on a Possible duplicate (keep mine, use bank's, both
  real). "Review" stays a UI word for the Possible duplicate.
- **Answer mode**: `pick` (chosen by hand) or `fill` (set by the pile's fill button).
- **Scoring version**: the number naming one set of cleaning rules and bars.
- **Golden set**: reviewed, labelled pairs that gate scoring changes.
- **Promote**: move a reviewed answer into the golden set.
- **Human feedback**, not "online evals": vendors use "online evals" for automatic
  scoring of live traffic.
