locals {
  project              = "personal-finance"
  github_repo          = "samjmarshall/${local.project}"
  is_prod              = var.environment == "production"
  vercel_team_slug     = "rekurve"
  vercel_oidc_issuer   = "oidc.vercel.com/${local.vercel_team_slug}" # Team issuer mode
  vercel_oidc_audience = "https://vercel.com/${local.vercel_team_slug}"
  vercel_project_id    = local.is_prod ? vercel_project.this[0].id : data.vercel_project.this[0].id
  prod_domain          = "finance.sammarshall.co"

  # Bedrock model the process-receipt worker invokes. Edit both together to
  # switch models. `au.` is the Australia geographic inference profile: receipt
  # data stays in AU regions, and it is what ap-southeast-2 grants (`apac.` is
  # not). Bare `anthropic.*` ids are not invocable; the foundation-model id only
  # scopes the IAM grant (iam.tf). Referenced by the Vercel env var and the IAM
  # policy so the two cannot drift.
  bedrock_receipt_model    = "au.anthropic.claude-sonnet-4-6"
  bedrock_foundation_model = "anthropic.claude-sonnet-4-6"
}
