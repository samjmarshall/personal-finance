# Production state only: production and preview send to one PostHog project, and
# every branch shares the preview state, so preview owning these would duplicate
# them or let an unmerged branch change them.
#
# Unmanaged on purpose: `posthog_project` (name + timezone only, and a destroy
# deletes all telemetry), the starter dashboard/insights, the GeoIP transformation
# and project settings (no provider support).
#
# A UI edit to anything here is reverted by the next `main` apply. Edit it here.

resource "posthog_insight" "ai_daily_cost" {
  count       = local.is_prod ? 1 : 0
  name        = "AI cost per day (USD)"
  description = "Sum of $ai_total_cost_usd per day, all environments. Backs the daily AI cost alert. Managed in Terraform (infrastructure/posthog.tf): UI edits are reverted."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      kind      = "TrendsQuery"
      interval  = "day"
      dateRange = { date_from = "-30d" }
      # Pinned off: test users' calls bill too, and the project default can change.
      filterTestAccounts = false
      series = [{
        kind          = "EventsNode"
        event         = "$ai_generation"
        math          = "sum"
        math_property = "$ai_total_cost_usd"
      }]
    }
  })
}

resource "posthog_alert" "ai_daily_cost" {
  count           = local.is_prod ? 1 : 0
  name            = format("AI cost today over $%v", local.ai_daily_cost_alert_usd)
  insight         = posthog_insight.ai_daily_cost[0].id
  series_index    = 0
  condition_type  = "absolute_value"
  threshold_type  = "absolute"
  threshold_upper = local.ai_daily_cost_alert_usd
  # Hourly on today's still-open bucket: a runaway day alerts within ~1h, not
  # after midnight.
  calculation_interval   = "hourly"
  check_ongoing_interval = true
  subscribed_users       = local.posthog_alert_user_ids
  enabled                = true
}

resource "posthog_cohort" "internal_test_users" {
  count       = local.is_prod ? 1 : 0
  name        = "Internal / Test users"
  description = "People who are internal team members or test users. Used for filtering out internal traffic from analytics."
  is_static   = false
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

  # The project's test-account filters point at this id; a replacement would
  # silently stop them filtering.
  lifecycle {
    prevent_destroy = true
  }
}

# Adopts the hand-made cohort. A no-op once it is in state; empty in preview.
import {
  for_each = local.is_prod ? toset(["570363"]) : toset([])
  to       = posthog_cohort.internal_test_users[0]
  id       = each.value
}
