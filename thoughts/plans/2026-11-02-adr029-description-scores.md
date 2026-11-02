---
date: 2026-11-02
adrs: [adr029]
status: Done
---
# Pair bank rows by word and meaning scores (adr029) Implementation Plan

## Context
The reconcile Adopts any same-day, same-amount pair and ignores the description. So two $22.99 subscriptions on one day ("PAYPAL \*NETFLIX AUS" and "PAYPAL \*SPOTIFY\*P40603 AUS") Adopt each other and nobody is asked. The partner and the pile come from a raw shared-word count, which also counts noise like "PAYPAL" and "AUS". adr029 (Proposed) fixes this:
- clean the text, then score it two ways: rare shared words (IDF) and meaning (a Bedrock embedding)
- Adopt only when both scores are high
- use the merged score to pick the partner and the pile

## Current State
- **Planner:** `planReconcile` (`src/domain/transactions/reconcile-synced.ts:106-230`) is pure.
  - It pairs bank rows to candidates with the same cents within `MATCH_DAYS = 7` (`:6`, loop `:159-178`).
  - Exact pairs Adopt on `dayGap === 0 && canAdopt` alone (`:191-206`). The description is only a sort key: `sharedWords` desc (`:193-198`, `:210-216`). The count comes from `descriptionWords`/`sharedWords` (`:12-27`).
  - `SIMILAR_WORDS = 3` (`:9`).
  - `Flag` has no score (`:71-75`).
- **Service:** `TransactionsService.reconcileSynced` (`src/server/transactions/transactions.service.ts:142-164`) groups rows by provenance.
  - `reconcileGroup` (`:243-269`) reads known ids, reviews and candidates (`:250-258`), then calls `repository.applyReconcile(planReconcile(...))` (`:259-268`).
  - The DB transaction opens inside `applyReconcile` (`transactions.repository.ts:367-368`), so anything awaited before `:259` is outside it.
  - The service has no `logger` and no AI dep (`:85-89`). It's built once in `transactions.module.ts:8-12` and shared by `src/server/api/services.ts:15` and `src/server/inngest/functions.ts:18`.
- **Callers:** the only caller is `CdrSyncService` (`cdr-sync.service.ts:234` import chunk, `:418` daily sync), typed `Pick<TransactionsService, "reconcileSynced">` (`:54`, `:66`).
- **Reviews:** a new flag is inserted at `transactions.repository.ts:399-416`, a refreshed review is updated at `:418-435`, and the list query is `:452-478`.
  - Table `possible_duplicate`: `transactions.schema.ts:89-123`.
  - Interfaces: `PossibleDuplicate` (`transaction.interface.ts:44-57`) and `PossibleDuplicateReview` (`:60-70`). Both are bound by `src/server/db/schema-interface-contract.test.ts`.
- **Piles:** computed on the client. `duplicatePiles` checks `sharedWords(...) >= SIMILAR_WORDS` (`import.display.ts:149-150`); pile copy is at `:121-134`.
- **Bedrock:**
  - `bedrock` provider: `src/server/aws/bedrock.ts:1-13`, OIDC via `credentials.ts:17-26`. It's bound only in the worker root (`functions.ts:38`; `.claude/rules/server-architecture.md`, `bedrock-invocation.md`).
  - IAM grants only the receipt inference profile plus a foundation-model wildcard gated on that profile (`infrastructure/iam.tf:5-31`), so a bare Titan call would be denied.
  - Model ids live in `infrastructure/locals.tf:17-18`, Vercel env in `infrastructure/vercel.tf:57-85`, app env in `src/env.ts:38-42`, runtime mapping at `:170`.
- **SDK:** `ai` 7.0.155 has `embedMany` (`node_modules/ai/dist/index.d.ts:8076`) and `MockEmbeddingModelV4` in `ai/test`. `@ai-sdk/amazon-bedrock` 5.0.126 has `bedrock.embedding(id)`:
  - Titan body: `{ inputText, dimensions, normalize }`, 1 value per call.
  - Cohere body: `input_type` (default `search_query`) and `texts`.
  - Options go under `providerOptions.bedrock` (`dist/index.js:2099-2133`).
- **Telemetry:** AI SDK telemetry is on by default once registered (`otel.ts:84`). `span-processor.ts:35-38,66-73` stamps Claude token prices on every `ai.*` span.
- **Database:** drizzle-orm 0.45.4 has a `vector` column (`pg-core/columns/vector_extension`). No `CREATE EXTENSION` exists yet. The custom migration precedent is `drizzle/0025_release_near_amount_reviews.sql`, and the last migration is `0025`. Neon supports pgvector on every plan.
- **Region:** Titan Text Embeddings V2 is in-region in `ap-southeast-2` with a bare model id and no `au.` profile. Cohere Embed English/Multilingual v3 are in-region too.

## Desired End State
- A same-day, same-amount pair Adopts only when its word score and meaning score both clear their Adopt bars. Any other same-amount pair within 7 days becomes a Possible duplicate. That includes same-day pairs that fall short.
- The partner is picked by merged score, then nearest day. A new review stores its merged score in `possible_duplicate.description_score`. The import page piles reviews by that score.
- Embeddings come from the model chosen in Phase 2, through the existing Bedrock/OIDC path. They're cached in `description_embedding` (pgvector, keyed by model and cleaned text) and fetched before the reconcile's DB transaction.
- When Bedrock fails after the AI SDK's 2 retries, or there are no AWS creds:
  - the reconcile logs `embedding unavailable`
  - it makes no Adopts and picks partner and pile by word score
  - the bank data still lands
- `make check` and `make test` pass. adr029's open questions are answered in the ADR.

## Out of Scope
- Backfilling or undoing Adopts made under the old rule (adr029 item 7).
- Rescoring a review when it's refreshed by a later sync, or when a Member edits their own row. A review keeps the score it was flagged with.
- Rescoring reviews made before this ships. They have no score and keep today's word-count pile.
- Any vector index, similarity search, Voyage or OpenAI.
- Pricing embedding spend in PostHog, and `infrastructure/pricing.tf`.
- Phase 9 (RedBark webhook) of `thoughts/plans/2026-09-15-expense-linking-stage-7-cdr-redbark.md`.
- Changing `MATCH_DAYS` or the same-cents rule.

## Approach
Build on a new branch, `feat/adr029-description-scores`.

1. Pure domain code first: cleaning, the IDF word score, the cosine and the merge.
2. A throwaway spike picks the model and cut-offs by a fixed rule, and records them in adr029.
3. Move the reconcile into its own worker service, so the embedding model and logger are bound only in `functions.ts`. This follows the service split rule and the receipts precedent.
4. Change the planner to take word weights and a vector map as plain data, so it stays pure and deterministic. Then light up meaning scores with the cache and Bedrock.
5. Finally, switch the piles to the saved score.

## Phase 1: Clean text and word score
### Changes
- `src/domain/transactions/description-score.ts` (new). It has no imports, so the Phase 2 node script can load it.
  - `PROCESSOR_PREFIXES = ["PAYPAL", "SQ", "SP", "ZLR", "IZ", "LS"]`. A prefix is stripped only when it starts the text and is followed by `*` (case-blind), so "SPOTIFY" and "SP CAFE" stay whole.
  - `NOISE_WORDS = ["AUS", "AU"]`.
  - `cleanDescription(text): string`:
    - strip the prefix, uppercase, then split like `descriptionWords` (`reconcile-synced.ts:12-19`)
    - drop noise words and any token with 3 or more digits (card and reference codes like `P40603`, `4029357733`)
    - keep the first appearance of each word, in order, joined by single spaces
    - all noise gives `""`
  - `wordWeights(corpus: Iterable<string>): WordWeights` counts document frequency over **distinct cleaned** descriptions, so a weekly merchant still weighs as rare.
  - `wordScore(a, b, weights)` takes cleaned inputs.
    - It's the cosine of the two binary word sets, each word weighted by `idf = ln((1 + docs) / (1 + df)) + 1`.
    - The result is in [0, 1]. An empty side scores 0.
  - `meaningScore(a: number[], b: number[])` is a cosine clamped to [0, 1]. It doesn't use `ai`'s `cosineSimilarity`: the domain index ships to the client.
  - `mergedScore(word, meaning: number | null)` returns `word` when meaning is null, else `(word + meaning) / 2`.
  - `EMBEDDING_DIMENSIONS = 1024`. This fits both Titan V2's default and Cohere v3.
  - `interface DescriptionScore { word: number; meaning: number | null; merged: number }`.
- `src/domain/transactions/index.ts:1-83`: export the functions, `EMBEDDING_DIMENSIONS`, and the `WordWeights` and `DescriptionScore` types.
- `src/domain/transactions/description-score.test.ts` (new), one TDD slice per rule:
  - "PAYPAL \*NETFLIX AUS 4029357733 AUS" → "NETFLIX"
  - "PAYPAL \*SPOTIFY\*P40603 AUS" → "SPOTIFY"
  - "NETFLIX.COM SYDNEY AUS" → "NETFLIX COM SYDNEY"
  - "SQ \*BEAN THERE CAFE" → "BEAN THERE CAFE"
  - "SPOTIFY" is kept, "99 BIKES" keeps "99", "Netflix" → "NETFLIX", all noise → ""
  - word score: identical → 1, disjoint → 0, symmetric, empty → 0; a rare shared word beats a common one (corpus where "SYDNEY" is in most descriptions)
  - meaning score: same → 1, orthogonal → 0, opposite → 0
  - merge: null meaning gives the word score, otherwise the mean

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] The crossed pair cleans to "NETFLIX" and "SPOTIFY", with word score 0 (unit test)

## Phase 2: Spike to pick the model and cut-offs
### Changes
- Throwaway branch `spike/adr029-description-scores`, cut from the feature branch after Phase 1 (prototype skill, rule 6).
- `scripts/spike-description-scores.ts` lives on the spike branch only. Run it with `node` and with AWS creds from `assume <profile>`.
  - It imports `../src/domain/transactions/description-score.ts`, `postgres`, `ai` (`embedMany`) and `@ai-sdk/amazon-bedrock` (`createAmazonBedrock({ region: "ap-southeast-2" })`).
  - It reads `DATABASE_URL` for `local/<branch>` (`make db_branch_status` must show `*` on it). It only reads.
- **Pairs:** every `possible_duplicate` row with status `pending` or `kept`, joined to its `transaction.description`. Add 3 fixed cases:
  - "PAYPAL \*NETFLIX AUS" vs "PAYPAL \*SPOTIFY\*P40603 AUS" (different)
  - "Netflix" vs "NETFLIX.COM SYDNEY AUS" (same)
  - "Woolies" vs "WOOLWORTHS 1234 SYDNEY" (same)
- **Labels:**
  - `kept` means same purchase (the Member dropped the bank's copy).
  - Label each `pending` pair same or different from its two descriptions. Drop any you can't tell.
  - The user confirms the labelled list before scoring.
- **Corpus:** `SELECT DISTINCT description FROM transaction`.
- **Cleaning list:** print the 40 most common cleaned tokens by distinct-description count. A token joins `PROCESSOR_PREFIXES` or `NOISE_WORDS` if it's a processor, place code or card noise and never part of a merchant's name.
- **Models:** embed each cleaned text with:
  - `amazon.titan-embed-text-v2:0`, using `{ dimensions: 1024, normalize: true }`
  - `cohere.embed-english-v3`, using `{ inputType: "clustering" }`
- **Fixed decision rule:**
  - **Model:** the higher ROC AUC of meaning score over same-vs-different pairs. If the two AUCs are within 0.02, Titan V2 wins (cheaper, no input type). If Cohere isn't callable in the account or region, Titan V2 wins and the reason is recorded. If Titan V2 isn't callable either, stop and report to the user.
  - **`ADOPT_WORD_SCORE`:** the larger of 0.5 and (highest word score of any *different* pair + 0.05), rounded up to 2 decimals.
  - **`ADOPT_MEANING_SCORE`:** the same rule with floor 0.7 and the chosen model's meaning score.
  - **Merge:** equal weights (`mergedScore`), not tuned.
  - **`SIMILAR_SCORE`:** the merged-score cut with the best accuracy (same at or above the cut, different below). Ties go to the higher cut.
- `docs/adr/adr029-pair-bank-rows-by-word-and-meaning-scores.md` (on the feature branch). This implements the decision.
  - Item 3 (`:52`): name the chosen model and its id.
  - Item 6 (`:58`): change "after the step's retries" to "after the AI SDK's 2 retries".
  - Add an item with:
    - the three thresholds
    - equal-weight merge
    - the cleaning list
    - the IDF corpus: distinct cleaned household descriptions plus the incoming batch, recomputed on each reconcile that has a pair, nothing stored
    - the 1024 dimensions
    - label counts, both AUCs, and a pointer to the spike branch
  - Replace `## Open Questions` (`:133-140`) with the answers. Status stays Proposed.
- `src/domain/transactions/description-score.ts` and its test: add any tokens the spike promoted to the lists, with one test case each.

### Success
- [x] The user confirmed the labelled pair list
- [x] The script ran against `local/<branch>` with both models, or with Titan V2 alone and the reason recorded
- [x] adr029 names the model, the three thresholds, the cleaning list and the IDF corpus, and has no open questions left
- [x] `make check` passes
- [x] `make test` passes

## Phase 3: Move the reconcile into its own service
### Changes
- `src/server/transactions/transaction-reconcile.service.ts` (new):
  - `interface TransactionReconcileServiceDeps { repository: Pick<TransactionsRepository, "findKnownExternalIds" | "findReviews" | "findMatchCandidates" | "applyReconcile"> }`
  - Class `TransactionReconcileService` takes over, unchanged:
    - `reconcileSynced` (`transactions.service.ts:142-164`)
    - `reconcileGroup` (`:243-269`)
    - `MS_PER_DAY`, `SCAN_BEFORE_DAYS`, `SCAN_AFTER_DAYS` (`:51-55`)
  - Split rule: the worker caller is about to need an embedding model and a logger that tRPC never uses.
- `src/server/transactions/transactions.service.ts`: delete the moved code and the imports it leaves unused (`planReconcile`, `HOUSEHOLD_TIME_ZONE` if unused).
- `src/server/transactions/transaction-reconcile.service.test.ts` (new): move the `reconcileSynced` block from `transactions.service.test.ts:193-329` as is. Only construction changes. These tests are the characterization tests.
- `src/server/cdr/cdr-sync.service.ts:19,54,66`: retype the `transactions` dep to `Pick<TransactionReconcileService, "reconcileSynced">`.
- `src/server/inngest/functions.ts:48-57`: build `new TransactionReconcileService({ repository: new DrizzleTransactionsRepository({ db }) })` and pass it as `transactions`. Update the root comment at `:22-26`.
- `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md:49,73,115` and the file list in `docs/feature/history-import.md` (`:28-42`): rename to `TransactionReconcileService.reconcileSynced`.

### Success
- [x] `make check` passes
- [x] `make test` passes, and the moved tests pass with only their construction changed
- [x] `grep -rn reconcileSynced src/server/transactions/transactions.service.ts` finds nothing

## Phase 4: Score pairs; an Adopt needs both scores
Meaning scores aren't wired up until Phase 5. Until then every pair has `meaning: null`, so this phase makes **no Adopts**: every same-day pair goes to review. That's the planned fallback, not a bug.

### Changes
- `src/domain/transactions/description-score.ts`:
  - Add `ADOPT_WORD_SCORE`, `ADOPT_MEANING_SCORE` and `SIMILAR_SCORE` with the values recorded in adr029 (Phase 2).
  - Add `scoreDescriptions(bank, mine, weights, vectors: ReadonlyMap<string, number[]> | null): DescriptionScore`.
    - It cleans both sides.
    - `meaning` is null when `vectors` is null or either cleaned text has no vector.
- `src/domain/transactions/reconcile-synced.ts`:
  - Export `matchPairs(input)`. It returns the same-cents, ≤7-day pairs, using the not-known, no-review split (`:119-133`) and the pair loop (`:159-178`). `planReconcile` calls it, so the service and planner can't drift.
  - `ReconcileInput` (`:50-61`) gains `weights: WordWeights` and `vectors: ReadonlyMap<string, number[]> | null`. `matchPairs` takes the input without these two.
  - `Pair` (`:91-96`) replaces `sharedWords` with `score: DescriptionScore`.
  - The exact filter (`:192`) adds both scores at or above their Adopt bars. A null meaning never Adopts.
  - Both sorts (`:193-198`, `:210-216`) use `y.score.merged - x.score.merged` in place of `sharedWords`.
  - `Flag` (`:71-75`) gains `descriptionScore: number | null`. A new flag carries `score.merged`; a refreshed review (`:124-128`) carries null.
  - A held candidate whose same-day pair fails the gate stays unflaggable (`canFlag`, `:143-144`), so its bank row goes to another candidate or to `add`.
  - Rewrite the JSDoc (`:98-104`).
  - `SIMILAR_WORDS`, `descriptionWords` and `sharedWords` stay, for the client fallback in Phase 6.
- `src/server/transactions/transactions.schema.ts:106`: add `descriptionScore: d.doublePrecision()` (nullable). Comment: merged score at flag time (adr029); null on reviews flagged before it.
- `src/domain/transactions/transaction.interface.ts:44-57`: add `descriptionScore: number | null` to `PossibleDuplicate`.
- `drizzle/0026_*.sql`: generated with `make db_generate`, then applied with `make db_migrate`. It adds one nullable column (expand-only).
- `src/server/transactions/transactions.repository.ts`:
  - Add `listDescriptions(): Promise<string[]>` (`selectDistinct` on `transaction.description`) to the interface (`:60-120`) and to the class.
  - The insert at `:403-408` writes `descriptionScore`. The update at `:424-433` leaves it alone.
- `src/server/transactions/transaction-reconcile.service.ts`:
  - The repository pick gains `listDescriptions`.
  - `reconcileGroup` runs `matchPairs`. Only when there's a pair does it build `wordWeights([...await listDescriptions(), ...incoming descriptions])`.
  - It passes `weights` and `vectors: null` to `planReconcile`.
- `src/domain/transactions/reconcile-synced.test.ts`:
  - The `plan()` helper (`:54`) defaults `weights` and `vectors`.
  - Rework the word tests (`:211`, `:229`, `:247`) to use merged score. New slices:
    - Netflix and Spotify on the same day with low meaning → both flagged, no Adopt
    - same day with both scores high → Adopt
    - same day, word high, `vectors: null` → flagged
    - typed "Netflix" vs bank "NETFLIX.COM SYDNEY AUS" beats a nearer-day stranger
    - a held candidate failing the gate → its bank row added
    - a new flag carries the merged score; a refreshed review carries null
  - The determinism test (`:335`) still passes.
- `src/domain/transactions/description-score.test.ts`: `scoreDescriptions` with a missing vector and with a null map.
- `src/server/transactions/transactions.repository.test.ts`:
  - inline snapshot for `listDescriptions`
  - `applyReconcile` (`:580-886`) insert snapshot with `description_score`
  - the refresh update snapshot unchanged
- `src/server/transactions/transaction-reconcile.service.test.ts`:
  - `listDescriptions` isn't read when there's no pair
  - the corpus includes the incoming descriptions
- `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md:51,52,55,103`: Adopt needs the description test, Possible duplicate includes same-day pairs that fall short, pairing goes by merged score, and :103 notes the fix (adr029). The same changes go in `docs/feature/history-import.md:114,116,120`. `CONTEXT.md` already has the wording; its "Proposed" markers go when `/validate` accepts adr029.

### Success
- [x] `make check` passes (includes `db:check` and the schema/interface contract)
- [x] `make test` passes
- [x] `make db_migrate` applied `0026` on `local/<branch>` (`make db_branch_status` shows `*`)
- [x] An import of a fresh range on the branch DB makes no new Adopts, and each new `possible_duplicate` row has a `description_score`

## Phase 5: Meaning score from Bedrock, with a cache
### Changes
- `drizzle/0027_enable_pgvector.sql`: created with `make db_custom name=enable_pgvector`. It contains `CREATE EXTENSION IF NOT EXISTS vector;`, with `--` comments and a Rollback note, like `drizzle/0025_release_near_amount_reviews.sql`.
- `src/server/transactions/transactions.schema.ts`: add `descriptionEmbeddings = pgTable("description_embedding", ...)`.
  - Columns: `id` (identity), `model` text not null, `description` text not null (cleaned), `embedding: vector({ dimensions: EMBEDDING_DIMENSIONS })` not null, `createdAt`.
  - `uniqueIndex("description_embedding_model_description_idx").on(t.model, t.description)`. No vector index.
  - The cache is owned by the transactions domain (adr022). It's already spread in `src/server/db/index.ts:28`.
- `drizzle/0028_*.sql`: generated with `make db_generate`; then run `make db_migrate`.
- `src/domain/transactions/transaction.interface.ts`: add `interface DescriptionEmbedding`. Add its pair to `src/server/db/schema-interface-contract.test.ts`.
- `src/server/transactions/transactions.repository.ts`: add two methods.
  - `findEmbeddings(model, descriptions)` returns `{ description, embedding }[]`.
  - `saveEmbeddings(model, rows)` inserts with `onConflictDoNothing` on (model, description).
- `src/env.ts`: add `BEDROCK_EMBEDDING_MODEL: z.string().default("<Phase 2 model id>")` next to `:42`, with a doc line (bare foundation-model id, switch in `infrastructure/locals.tf`). Add the runtime mapping next to `:170`.
- `src/server/transactions/transaction-reconcile.service.ts`:
  - The deps gain `embeddingModel: EmbeddingModel` (from `ai`; an SDK object dep, like `languageModel`) and `logger: Logger`. The repository pick gains `findEmbeddings` and `saveEmbeddings`.
  - Private `vectorsFor(texts): Promise<Map<string, number[]> | null>`:
    1. Take the distinct, non-empty cleaned texts.
    2. Read the cache, keyed by `this.embeddingModel.modelId`.
    3. Embed the misses with `embedMany({ model, values, maxRetries: 2, maxParallelCalls: 4, abortSignal: AbortSignal.timeout(30_000), providerOptions: { bedrock: { dimensions: EMBEDDING_DIMENSIONS, normalize: true, inputType: "clustering" } }, telemetry: { isEnabled: false } })`.
       - Each body ignores the other family's keys (`dist/index.js:2109-2125`).
       - Telemetry is off because `span-processor.ts:66-73` would stamp Claude prices on it.
    4. Save the new vectors, then return the map.
  - Only an `embedMany` error is caught: `logger.warn("embedding unavailable", { error, descriptions: n })`, then return null. DB errors bubble up and retry as today.
  - `reconcileGroup` calls `vectorsFor` on the cleaned descriptions of both sides of every `matchPairs` pair, before `applyReconcile`, and passes the map to `planReconcile`.
- `src/server/inngest/functions.ts`: bind `embeddingModel: bedrock.embedding(env.BEDROCK_EMBEDDING_MODEL)` and `logger: createRootLogger().with({ domain: "transactions", component: "reconcile" })`.
- `src/server/transactions/transaction-reconcile.service.test.ts`, using `MockEmbeddingModelV4` from `ai/test`:
  - a cache hit makes no model call
  - a miss embeds and saves under the model id
  - a model error logs `embedding unavailable`, the plan still lands, and the same-day pair is flagged, not adopted
  - no pair means no model call
  - with `InMemorySpanExporter`/`registerTelemetry` as in `receipt-extraction.service.test.ts:88-107`, no `ai.*` span is recorded
- `src/server/transactions/transactions.repository.test.ts`: inline snapshots for `findEmbeddings` and `saveEmbeddings`.
- `infrastructure/locals.tf:17-18`: add `bedrock_embedding_model = "<Phase 2 model id>"` with a comment (in-region bare id, no inference profile).
- `infrastructure/iam.tf:5-31`: add a statement. Actions: `bedrock:InvokeModel`. Resources: `arn:aws:bedrock:${data.aws_region.current.region}::foundation-model/${local.bedrock_embedding_model}`. No profile condition.
- `infrastructure/vercel.tf:57-85`: add `BEDROCK_EMBEDDING_MODEL = { value = local.bedrock_embedding_model, sensitive = false }`.
- Docs:
  - `docs/README.md`: an env row after `:28`, and an embeddings sentence in "Claude on Bedrock" (`:44-46`).
  - `.claude/rules/bedrock-invocation.md`: the first two bullets get the embedding exception (bare in-region id) and `BEDROCK_EMBEDDING_MODEL`.
  - `docs/feature/history-import.md`: the job sequence (`:91`) gains the embedding step before `applyReconcile`.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `make db_migrate` applied `0027` and `0028` on `local/<branch>`
- [x] `/security-review` (touches `src/env.ts`): no findings
- [x] `terraform -chdir=infrastructure fmt -check` passes. The `deploy.yml` plan for the branch shows exactly one new IAM statement and one new Vercel env var (run 41449884007: 1 to add, 1 to change, 0 to destroy)
- [x] Without AWS creds, an import on the branch DB logs `embedding unavailable` and finishes with its rows landed
- [x] With `assume <profile>`, an import fills `description_embedding` with 1024-length vectors under the model id. A same-day pair whose descriptions match Adopts; a same-day Netflix/Spotify-style pair goes to review

## Phase 6: Pile reviews by the saved score
### Changes
- `src/domain/transactions/transaction.interface.ts:60-70`: add `descriptionScore: number | null` to `PossibleDuplicateReview`.
- `src/server/transactions/transactions.repository.ts:452-478`: `listPendingDuplicates` selects `descriptionScore`.
- `src/app/(dashboard)/transactions/import/_components/import.display.ts`:
  - `isSimilar` (`:149-150`) uses `descriptionScore >= SIMILAR_SCORE`. When the score is null (a review flagged before adr029), it falls back to `sharedWords(...) >= SIMILAR_WORDS`.
  - Comment at `:120`: say "the descriptions" in place of "the words".
  - Pile copy (`:125`, `:131`):
    - "The descriptions match. Almost always the same purchase."
    - "The descriptions don't match. Most likely two purchases."
- `src/app/(dashboard)/transactions/import/_components/import.display.test.ts`:
  - scores above, at and below `SIMILAR_SCORE`
  - a null score falls back to word count
  - the empty pile is still dropped
- `src/app/(dashboard)/transactions/import/_components/possible-duplicate-piles.test.tsx`: give the fixtures a `descriptionScore` and assert the new copy. Update any other `PossibleDuplicateReview` fixtures that typecheck finds.
- `src/server/transactions/transactions.repository.test.ts:888`: update the `listPendingDuplicates` snapshot.
- `docs/feature/history-import.md:125-127`: the piles go by description score, and reviews from before adr029 go by 3+ shared words.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `/design-review`: no UI blockers; High = Vercel FRGN AMT row scores 0.585, a cleaning gap
- [x] On `/transactions/import`:
  - a review with a high score sits under "Similar description" and a low one under "Different description"
  - an older review with no score keeps its pile from before this change
  - fill and Apply still work

## References
- ADRs:
  - `docs/adr/adr029-pair-bank-rows-by-word-and-meaning-scores.md` (Proposed): Phase 2 answers its open questions; Phases 4–6 implement it. `/validate` sets it Accepted and updates the `CONTEXT.md` markers (`CONTEXT.md:107-117`).
  - Composes with `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` facet 2 (`:49-55`), `docs/adr/adr014-bedrock-via-vercel-oidc.md` and `docs/adr/adr022-cross-domain-data-through-the-owning-service.md`.
- Prior plan: `thoughts/plans/2026-09-15-expense-linking-stage-7-cdr-redbark.md` (Phase 8 brought in the piles and the word count).
- Feature doc: `docs/feature/history-import.md`.
- Rules: `.claude/rules/server-architecture.md` (service split rule, worker root), `.claude/rules/bedrock-invocation.md`.
- Code:
  - `src/domain/transactions/reconcile-synced.ts:106-230`
  - `src/server/transactions/transactions.service.ts:142-164,243-269`
  - `src/server/transactions/transactions.repository.ts:320-478`
  - `src/server/cdr/cdr-sync.service.ts:54,234,418`
  - `src/server/inngest/functions.ts:38,48-57`
  - `src/server/aws/bedrock.ts:1-13`
  - `infrastructure/iam.tf:5-31`
  - `src/app/(dashboard)/transactions/import/_components/import.display.ts:121-158`
- PR: #120, the base branch for this work.
