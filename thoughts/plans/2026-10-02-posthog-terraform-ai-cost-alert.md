---
date: 2026-10-02
adrs: [adr015]
status: Ready to implement
---
# PostHog config in Terraform: AI daily cost alert — Implementation Plan

## Context

Receipt AI calls are now capped per call (`maxOutputTokens`, timeout, retries; commit `3f50916`), but nothing catches many calls in one day. adr015 lists "an insight alert on daily AI spend" as a consequence that is still owed (`docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md:61`). The member wants PostHog config managed in Terraform as much as possible. This plan adds the PostHog Terraform provider, an AI cost-per-day insight and an alert on it, and imports the one hand-made config object worth keeping (the test-users cohort). Nothing changes for members.

## Current State

- **PostHog appears in Terraform only as Vercel env vars.**
  - `POSTHOG_KEY` and `POSTHOG_PROJECT_ID` are set at `infrastructure/vercel.tf:81-88`, from `var.posthog_key` and `var.posthog_project_id` (`infrastructure/variables.tf:11-34`).
  - Nothing inside the PostHog project is managed in code.
- **Providers.**
  - `required_providers` lists only aws `6.25.0` and vercel `~> 5.0` (`infrastructure/terraform.tf:2-11`). Lock entries are at `infrastructure/.terraform.lock.hcl:4,28`.
  - The vercel provider reads its token from an env var, noted in a trailing comment (`infrastructure/providers.tf:13-15`). Mirror this.
- **Two states, one PostHog project.**
  - `ENVIRONMENT` is `production` on `main` and `preview` on any other branch (`.github/workflows/deploy.yml:32`). The preview state is shared by every branch (`docs/infrastructure.md:9`).
  - Production and preview send to the same PostHog project (`609915`).
  - Objects that should exist once use `count = local.is_prod ? 1 : 0` (`infrastructure/vercel.tf:2,49,108`, `is_prod` at `infrastructure/locals.tf:4`).
- **CI.**
  - The `terraform-apply` job env holds `VERCEL_API_TOKEN` and the `TF_VAR_posthog_*` values (`deploy.yml:51-58`), then runs `make apply env="$ENVIRONMENT"` (`:83`).
  - The `health-check` job only runs `make init` plus `terraform output` (`deploy.yml:249-255`). It configures no providers, so it needs no new env.
  - The `fmt-check` gate runs in `.github/workflows/quality-control.yml:86-96`.
  - `make validate`/`plan` depend on `init`, which needs the S3 backend (`infrastructure/Makefile:22-35`). So locally, run `assume <profile>` first.
- **Where the cost data comes from.**
  - `PostHogSpanProcessor` (`src/server/observability/sdk/otel.ts:47-50`) emits `$ai_generation` events that carry `$ai_total_cost_usd`.
  - Only 4 calls so far, $0.055 total, about $0.014 per receipt.
  - With the per-call caps (`src/server/receipts/receipt-extraction.service.ts:66,71,73,448`), the worst case is about $0.15 per image call and about $0.47 per 300 KB HTML call.
- **What exists in PostHog today.**
  - PostHog starter boilerplate: dashboard `2097324`, 8 default insights (`11891056`–`11891063`) and the GeoIP transformation.
  - One real config object: cohort `570363` "Internal / Test users". Its filter is person prop `$internal_or_test_user` exact `[true]`, inside an OR→AND group. It is dynamic. The project test-account filters point at it.
  - No alerts, flags or actions. Owner user id is `432149`.
- **Provider facts.** `PostHog/posthog` `1.0.21`:
  - Auth is a personal API key, read from env var `POSTHOG_API_KEY`. The host defaults to `https://us.posthog.com`, which is correct for us.
  - `posthog_project` only manages `name` and `timezone`, and destroying it deletes the whole project.
  - Project settings (test-account filters, replay, autocapture) have no resource.
- **Secret.** GitHub secret `POSTHOG_PERSONAL_API_KEY` exists (set 2026-10-01). The key is limited to project 609915 and has write access for insights, alerts and cohorts.

## Desired End State

- Both states configure the PostHog provider.
  - Production state owns `posthog_insight.ai_daily_cost[0]`, `posthog_alert.ai_daily_cost[0]` and `posthog_cohort.internal_test_users[0]` (imported, so its id stays `570363`).
  - Preview state owns no PostHog resources.
- An alert checks today's running AI cost every hour and emails user `432149` once it passes **$1**.
- `docs/infrastructure.md` says what Terraform owns in PostHog, how to run it locally, and that UI edits to managed objects get reverted by the next `main` apply.

## Out of Scope

- `posthog_project`: it only covers name and timezone, and one mistake deletes all telemetry.
- PostHog boilerplate (starter dashboard, default insights, GeoIP transformation) and project settings, which have no provider support.
- The other adr015 alerts: Logs alerts on `outbox.sweep.stuck` / `receipt.failed`, and Error Tracking.
- Sending the alert to Slack.
- Writing `posthog_project` `api_token`/`id` into the Vercel env vars, which would let us drop the `POSTHOG_KEY` secret.
- Moving `generateObject` to `generateText` + `Output.object`.
- An ADR. The member decided a docs update is enough.

## Approach

Add the provider to both states, but put every PostHog resource behind `local.is_prod`. That way the shared preview state can't duplicate the objects, and unmerged branches can't change them. The alert watches a daily-interval trends insight that sums `$ai_total_cost_usd`. It is checked hourly with `check_ongoing_interval = true`, so a runaway day alerts within about an hour instead of after the day ends. The cohort comes in through a config-driven `import {}` block, gated the same way, plus `prevent_destroy`. All of this is Terraform and docs; `src/` doesn't change.

## Phase 1: PostHog provider in both states

### Changes

- `infrastructure/terraform.tf:2-11`: add `posthog = { source = "PostHog/posthog", version = "1.0.21" }`, pinned exactly like aws.
- `infrastructure/.terraform.lock.hcl`: updated by `make init` (after `assume`). Commit the new `registry.terraform.io/posthog/posthog` entry.
- `infrastructure/providers.tf`: after the vercel block (`:13-15`), add:
  ```hcl
  provider "posthog" {
    project_id = var.posthog_project_id # api_key is read from the POSTHOG_API_KEY env var
  }
  ```
- `.github/workflows/deploy.yml:51-58`: add `POSTHOG_API_KEY: ${{ secrets.POSTHOG_PERSONAL_API_KEY }}` to the `terraform-apply` env. Put it next to `VERCEL_API_TOKEN` with a one-line comment that the posthog provider reads it. Both environments need it, because the provider is configured even when preview has no PostHog resources.

### Success

- [x] `make fmt-check` passes
- [x] `make validate` passes (after `assume`) — checked as `terraform validate` after a backend-less `init`; no AWS creds in session
- [ ] `make plan env=preview`, run with `POSTHOG_API_KEY` and `VERCEL_API_TOKEN` exported, shows no PostHog changes
- [ ] Branch push: the preview `terraform-apply` job is green

## Phase 2: AI cost per day insight and alert

### Changes

- `infrastructure/locals.tf`: add two locals, each with a short "why" comment:
  - `posthog_alert_user_ids = [432149]`: the PostHog user id of the owner.
  - `ai_daily_cost_alert_usd = 1`. Sizing: about 70 normal receipts at about $0.014 each. Normal use is under $0.30/day. Worst case is about 2 capped HTML calls.
- New `infrastructure/posthog.tf`. Start with a short header comment covering:
  - why everything here is production-only (one PostHog project, and the preview state is shared)
  - what is deliberately unmanaged, and why (see Out of Scope)
  - that UI edits get reverted on the next `main` apply

  Resources:
  - `posthog_insight.ai_daily_cost`:
    - `count = local.is_prod ? 1 : 0`, name `"AI cost per day (USD)"`, plus a description
    - query:
      ```hcl
      query_json = jsonencode({
        kind = "InsightVizNode"
        source = {
          kind      = "TrendsQuery"
          interval  = "day"
          dateRange = { date_from = "-30d" }
          series = [{
            kind          = "EventsNode"
            event         = "$ai_generation"
            math          = "sum"
            math_property = "$ai_total_cost_usd"
          }]
        }
      })
      ```
  - `posthog_alert.ai_daily_cost`:
    - `count = local.is_prod ? 1 : 0`, name `"AI cost today over $1"`
    - `insight = posthog_insight.ai_daily_cost[0].id`
    - `condition_type = "absolute_value"`, `threshold_type = "absolute"`, `threshold_upper = local.ai_daily_cost_alert_usd`, `series_index = 0`
    - `calculation_interval = "hourly"`, `check_ongoing_interval = true`
    - `subscribed_users = local.posthog_alert_user_ids`, `enabled = true`
  - **As built:** the query also pins `filterTestAccounts = false`. If omitted, it follows the project default, and turning that default on would hide test users' spend. The alert name comes from `format("AI cost today over $%v", local.ai_daily_cost_alert_usd)`, so the name tracks the threshold. A 2026-10-09 dry run of the query peaked at $0.055/day.

### Success

- [x] `make fmt-check` passes
- [x] `make validate` passes — backend-less, as Phase 1
- [ ] `make plan env=production` shows `+2` (insight, alert). The only other diff is the usual deployment diff.
- [ ] `make plan env=preview` still shows no PostHog changes
- [ ] After merge to `main`, PostHog MCP `alerts-list` shows 1 alert on the new insight
- [ ] `alert-simulate` on that alert over the last 30 days does not fire

## Phase 3: Import the test-users cohort

### Changes

- `infrastructure/posthog.tf`: add `posthog_cohort.internal_test_users`:
  - `count = local.is_prod ? 1 : 0`, `name = "Internal / Test users"`
  - the current description, verbatim: "People who are internal team members or test users. Used for filtering out internal traffic from analytics."
  - `is_static = false`
  - `filters = jsonencode(...)`, matching today's definition exactly:
    ```hcl
    filters = jsonencode({
      properties = {
        type = "OR"
        values = [{
          type = "AND"
          values = [{
            key      = "$internal_or_test_user"
            type     = "person"
            value    = [true]
            operator = "exact"
          }]
        }]
      }
    })
    ```
  - `lifecycle { prevent_destroy = true }`, with a comment that the project test-account filters point at this id
  - the import block below. It stays after the first apply: it is a no-op once the cohort is in state, and in preview it is empty.
    ```hcl
    import {
      for_each = local.is_prod ? toset(["570363"]) : toset([])
      to       = posthog_cohort.internal_test_users[0]
      id       = each.value
    }
    ```

### Success

- [x] `make fmt-check` passes
- [x] `make validate` passes — backend-less, as Phase 1
- [ ] `make plan env=production` shows `1 to import` for the cohort with **no in-place changes**. Adjust the attributes until it does.
- [ ] After merge, cohort `570363` is unchanged in PostHog: same id, same filter, same member count

## Phase 4: Docs

### Changes

- `docs/infrastructure.md:3`: the intro now says Terraform also owns PostHog alerting config: the AI cost insight and alert, and the test-users cohort. Production state only. In the same sentence, change "the three Bedrock env vars" to "the five Bedrock env vars" (`AWS_REGION`, `AWS_ROLE_ARN`, `BEDROCK_RECEIPT_MODEL`, `BEDROCK_{INPUT,OUTPUT}_TOKEN_PRICE_USD`, `infrastructure/vercel.tf:59-80`).
- `docs/infrastructure.md:7-13`: add a PostHog row to the layout table. Production: owns insight, alert and cohort. Preview: none, but the provider is still configured.
- `docs/infrastructure.md:19-26`: add `export POSTHOG_API_KEY=<key>` to "Local use". Comment: same value as the `POSTHOG_PERSONAL_API_KEY` GitHub secret; personal key, limited to project 609915.
- `docs/infrastructure.md:46`: add GitHub secret `POSTHOG_PERSONAL_API_KEY` to the list of secrets.
- `docs/infrastructure.md`: add a short note that a PostHog UI edit to a managed object is reverted by the next `main` apply. Change the object in `infrastructure/posthog.tf` instead.

### Success

- [x] `make check` passes
- [x] The docs list every new secret, env var and managed object

## References

- ADRs:
  - `docs/adr/adr015-posthog-over-opentelemetry-via-vercel-otel.md` (In Progress). Phase 2 delivers its daily AI spend alert (`:61`).
  - `docs/adr/adr013-terraform-owned-vercel-deployments.md` (Accepted). Terraform and CI deploy shape.
- Related:
  - `thoughts/plans/2026-09-23-bedrock-token-prices-from-price-list.md`: the source of `$ai_total_cost_usd`
  - commit `3f50916`: the per-call caps this alert backs up
  - `infrastructure/vercel.tf:2`: the `count = local.is_prod` precedent
- Provider docs: `github.com/PostHog/terraform-provider-posthog` `docs/resources/{insight,alert,cohort,project}.md`, version 1.0.21.
