---
date: 2026-09-23
adrs: [adr015]
status: Done
---
# Bedrock Token Prices from the AWS Price List Implementation Plan

## Context

`BEDROCK_INPUT_TOKEN_PRICE_USD` / `BEDROCK_OUTPUT_TOKEN_PRICE_USD` are stamped onto
`ai.*` spans as `$ai_input_token_price` / `$ai_output_token_price` so PostHog can price
Bedrock usage it cannot reliably auto-match (adr015 line 73 "Decision 11"). They are unset
today, so PostHog's heuristic matcher runs — which can miss (cost `$0`) or silently apply the
direct-Anthropic-API price instead of the Bedrock price. This plan sets both values from the
**live AWS Price List** at `terraform plan` time so the stamped price always matches the model
in `infrastructure/locals.tf`, and hard-fails the plan when the lookup returns nothing.

## Current State

- Both vars: optional positive numbers, `src/env.ts:122-123`; mirrored `src/env.ts:163-164`.
- Read once, `src/server/observability/sdk/otel.ts:65-66` → `SpanAttributeProcessor` deps
  (`src/server/observability/sdk/span-processor.ts:13-15`), stamped only on `ai.*` spans and only
  when defined (`src/server/observability/sdk/span-processor.ts:67-72`). **No app-side
  multiplication** — PostHog computes `$ai_total_cost_usd`. PostHog's `$ai_*_token_price` is
  **per single token**.
- Model `au.anthropic.claude-sonnet-4-6` — a geographic inference profile — set in
  `infrastructure/locals.tf:17-18` (`bedrock_receipt_model` + `bedrock_foundation_model`,
  edited together), pushed to Vercel via `local.vercel_env` in `infrastructure/vercel.tf:57-79`
  through the `vercel_project_environment_variable "this"` `for_each` (`infrastructure/vercel.tf:82-90`).
- Providers: `hashicorp/aws` pinned `6.25.0` (`infrastructure/terraform.tf`); default region
  `ap-southeast-2` (`infrastructure/providers.tf:1-11`); only `data.aws_region` /
  `data.aws_caller_identity` exist (`infrastructure/data.tf:1-3`).
- CI deployer role is `AdministratorAccess` (`docs/cloudformation-templates/github-actions.yaml:62-63`),
  assumed in `deploy.yml` (`.github/workflows/deploy.yml:68-70`) — already able to call the
  Price List API. Model-switch runbook: `docs/infrastructure.md:30-34`.

### Live Price List facts (probed 2026-09-23, account 139035987018, us-east-1 endpoint)

> **2026-10-09:** AWS moved Claude to service code `AmazonBedrockFoundationModels`; `AmazonBedrockMarketplace` no longer exists. Same attrs, usagetypes and prices. Code and docs use the new code.

- Service code `AmazonBedrock` holds only legacy Claude; `AmazonBedrockService` returned 0 rows
  for AU geo. **`AmazonBedrockMarketplace`** carries Claude Sonnet 4.6 for `ap-southeast-2` with
  structured attrs (`model`, `regionCode`, `feature`, `inferenceType`, `usagetype`).
- Global vs geographic tier is encoded **only** in `usagetype` (`_Global` suffix = Global;
  no suffix = "Regional CRIS"). `au.` is geographic → the non-`_Global` rows:

  | key    | usagetype (verified)                  | inferenceType   | unit      | USD    |
  |--------|---------------------------------------|-----------------|-----------|--------|
  | input  | `APS2-MP:APS2_InputTokenCount-Units`  | `Input tokens`  | 1M tokens | 3.30   |
  | output | `APS2-MP:APS2_OutputTokenCount-Units` | `Output tokens` | 1M tokens | 16.50  |

  (Global tier = 3.00 / 15.00.) Per-token: `0.0000033` / `0.0000165`.
- The 5-filter set in Phase 1 returns **exactly 1 row** each (verified). Dropping `usagetype`
  returns 2 → `aws_pricing_product` errors "not precise enough. Returned 2 elements"; a wrong
  `model` returns 0 → "did not return any elements". Both fail the plan (provider 6.25.0
  `internal/service/pricing/product_data_source.go`).
- Price List API is served only from `us-east-1` / `ap-south-1` / `eu-central-1` → an aliased
  provider is required. IAM `pricing:GetProducts` needs `Resource: "*"`.
- `terraform_data` (built-in, TF ≥1.4; local 1.15.6): `input` change → update in place;
  `output` persisted in state = last-applied value. Replaces `null_resource` with no extra
  provider.

## Desired End State

`terraform plan/apply` resolves the input/output per-token USD price for the model in
`locals.tf` from the live Price List, validates it (single row, unit `1M tokens`, USD > 0),
remembers the last applied value in state, and publishes both to Vercel as
`BEDROCK_INPUT_TOKEN_PRICE_USD` / `BEDROCK_OUTPUT_TOKEN_PRICE_USD`. A production
`$ai_generation` event shows `$ai_cost_model_source = custom` with a correct
`$ai_total_cost_usd`. Switching the model without updating its Price List identity fails the
plan loudly rather than shipping a wrong price.

## Out of Scope

- Any `src/` change — the env schema and processor already exist and are correct.
- Prompt-cache read/write pricing (rows exist; the processor stamps only input/output).
- Migrating the receipts domain / touching non-pricing Terraform.
- Global-tier pricing (the app uses the `au.` geographic profile).

## Approach

Add a data-only aliased `aws.pricing` provider, express the model's Price List identity as
locals beside `bedrock_receipt_model`, resolve two `aws_pricing_product` lookups in a new
`pricing.tf` (existence enforced by the data source; content enforced by postconditions), pin
the last applied value in a `terraform_data` resource, and feed its `output` into two new
`local.vercel_env` entries. Validation is layered so a lookup miss or a shape change can only
ever fail the plan — never publish an empty or wrong price. Docs and the model-switch runbook
gain the new co-edited knob.

## Phase 1: Price List lookup, validation, and remembered value

### Changes
- `infrastructure/providers.tf` — add a second `provider "aws"` with `alias = "pricing"`,
  `region = "us-east-1"` (data-only; resources keep the default `ap-southeast-2` provider).
- `infrastructure/locals.tf` — beside `bedrock_receipt_model` (`infrastructure/locals.tf:17-18`)
  add the Price List identity: `bedrock_pricing_model_name = "Claude Sonnet 4.6"`;
  `bedrock_pricing_region_prefix = lookup({ "ap-southeast-2" = "APS2" }, data.aws_region.current.region)`
  (no default → unknown region fails); and a `bedrock_pricing_usagetype` map building the
  geographic (non-`_Global`) input/output usagetypes from that prefix. Comment: the Price List
  keys on display name + usagetype, not the profile id, so this is edited with the model.
- `infrastructure/pricing.tf` (new):
  - `data "aws_pricing_product" "bedrock_token"` with `for_each = local.bedrock_pricing_usagetype`,
    `provider = aws.pricing`, `service_code = "AmazonBedrockMarketplace"`, and the five
    `filters` blocks: `model`, `regionCode` (= `data.aws_region.current.region`), `feature`
    (`"On-demand Inference"`), `inferenceType` (`"${title(each.key)} tokens"`), `usagetype`
    (`each.value`).
  - `locals.bedrock_price_dimension` — `jsondecode(result)` then unwrap the single-entry
    `terms.OnDemand` → `priceDimensions` maps via `values(...)[0]`.
  - `locals.bedrock_usd_per_token` — `tonumber(...pricePerUnit.USD) / 1000000` per key.
  - `resource "terraform_data" "bedrock_token_prices"` with `input = local.bedrock_usd_per_token`;
    two `lifecycle.precondition` blocks: `unit == "1M tokens"` (guards the ÷1e6) and
    `USD > 0` (guards empty/zero). Preconditions live on this resource so they reference the
    derived locals cleanly.

### Success
- [x] `make validate env=preview` passes (CI run 37931219326)
- [x] `make plan env=preview` shows `terraform_data.bedrock_token_prices` created with
      `output = { input = 0.0000033, output = 0.0000165 }` and two `data.aws_pricing_product`
      reads — `output` shows "(known after apply)" on create; `input` = 0.0000032999…98 / 0.0000165
- [x] Negative: temporarily set `bedrock_pricing_model_name = "Claude Sonnet 4.7"` → plan fails
      "did not return any elements"; revert — observed for real in CI run 37929986928 (stale service code, same 0-row path)
- [ ] Negative: temporarily drop the `usagetype` filter → plan fails "not precise enough.
      Returned 2 elements"; revert — skipped (user decision 2026-10-09; provider hard-fails >1 row by design)

## Phase 2: Publish to Vercel env vars

### Changes
- `infrastructure/vercel.tf` — add two entries to `local.vercel_env` (`infrastructure/vercel.tf:57-79`),
  both `sensitive = false`, values
  `format("%.10f", terraform_data.bedrock_token_prices.output.input)` and `...output.output`
  (fixed-decimal avoids `3.3e-06`; `z.coerce.number()` in `src/env.ts:122-123` accepts it).
  Reading from `terraform_data…output` (not the data source) is what ties the env var to the
  remembered value.

### Success
- [x] `make plan env=preview` shows two new `vercel_project_environment_variable` resources
      keyed `BEDROCK_INPUT_TOKEN_PRICE_USD` = `0.0000033000` and
      `BEDROCK_OUTPUT_TOKEN_PRICE_USD` = `0.0000165000` — created in CI run 37931219326; provider masks `value`, string verified offline via `format`
- [ ] Idempotence: a second `make plan` after apply reports no changes (unchanged price →
      `terraform_data` untouched → env vars untouched) — deferred to production after merge;
      shared preview state was reset by Renovate run 37931263055 (run 37931670914 re-added 3)
- [x] After deploy + one receipt: PostHog `$ai_generation` shows `$ai_cost_model_source = custom`,
      `$ai_input_token_price = 0.0000033`, and `$ai_total_cost_usd ≈ 3.3e-6·$ai_input_tokens +
      1.65e-5·$ai_output_tokens` — preview 2026-10-09 12:48 UTC, trace
      6a1495f073cdbb2ca287e97665720568: 1457 in × 3.3e-6 + 253 out × 1.65e-5 = 0.0089826 (exact)

## Phase 3: Docs, rules, and local example

### Changes
- `docs/README.md:36-37` — replace "Leave unset while PostHog reports cost natively" with: set
  by Terraform from the live AWS Price List for the model in `locals.tf`; per **token**;
  PostHog consumes it as the custom price.
- `docs/infrastructure.md:30-34` — in "Switch the receipt model", add a step: also set
  `bedrock_pricing_model_name` to the Price List display name (discover via `aws pricing
  get-attribute-values --region us-east-1 --service-code AmazonBedrockMarketplace
  --attribute-name model`); note `au.` = geographic tier (+10% over Global); `make plan` fails
  loudly if it drifts.
- `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md:73` — record the Decision 11
  outcome: fallback now enabled, fed from `AmazonBedrockMarketplace` at plan time, hard-fails
  on lookup miss.
- `.claude/rules/bedrock-invocation.md` (bullet 2, line 11) — "edit **both** …" → also
  `bedrock_pricing_model_name`.
- `.env.example` — add both vars (optional locally) with the per-token values and a "per token,
  not per 1M" comment.

### Success
- [x] `docs/README.md` and `.env.example` list both vars with per-token values
- [x] `docs/infrastructure.md` switch runbook names `bedrock_pricing_model_name`
- [x] `/security-review` (touches `.env.example`, matched by `**/*.env*`)
- [x] `make check` passes (no `src/` change; run for safety)

## References
- Ticket: none — derived from this session's research + adr015 "Decision 11"
- Related plan: `thoughts/plans/2026-09-15-posthog-observability.md` (Phase 11 / Risk 3 named
  this fallback)
- ADRs: `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md` (In Progress; price open question removed 2026-10-09) — line 73
  is the recorded decision this implements; its consequence note is updated in Phase 3
- Code: `src/env.ts:122-123`, `src/server/observability/sdk/otel.ts:65-66`,
  `src/server/observability/sdk/span-processor.ts:67-72`, `infrastructure/locals.tf:17-18`,
  `infrastructure/vercel.tf:57-90`, `infrastructure/providers.tf:1-11`,
  `infrastructure/data.tf:1-3`, `infrastructure/terraform.tf`,
  `docs/cloudformation-templates/github-actions.yaml:62-63`
- Provider: `aws_pricing_product` (hashicorp/aws 6.25.0) —
  `internal/service/pricing/product_data_source.go` (hard-fails on 0 / >1 rows)
- Working plan (this session): `~/.claude/plans/i-need-to-set-cached-treasure.md`
