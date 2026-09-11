resource "vercel_project" "this" {
  count = local.is_prod ? 1 : 0

  name      = local.project
  framework = "nextjs"

  git_repository = {
    type              = "github"
    repo              = local.github_repo
    production_branch = "main"
  }

  node_version = "24.x"

  # Pinned to the values the project had before import. Both are Optional-only
  # in the provider, so leaving them out would plan `<live> -> null` and switch
  # the feature off on apply.
  skew_protection = "12 hours"
  git_comments = {
    on_commit       = false
    on_pull_request = true
  }
  # No automatic production aliasing. deploy.yml stages each production deployment
  # un-aliased, gates it (migrate + /api/health behind the bypass header), then
  # runs `vercel promote` to move the domain — so the alias never sits on an
  # un-migrated build. The deployment lifecycle lives in deploy.yml, not here.
  auto_assign_custom_domains = false

  # Optional+Computed: undeclared they plan `-> (known after apply)`, which hides
  # whether the apply keeps them. Declared, they plan as unchanged.
  build_machine_type = "elastic"
  resource_config = {
    fluid                    = true
    function_default_regions = ["iad1"]
  }

  # install_command is deliberately unset. The dashboard had `yarn install`,
  # which built prod with yarn v1 and *no lockfile*; null lets Vercel detect
  # pnpm from pnpm-lock.yaml + package.json#packageManager, same as CI and local.

  # Team issuer mode puts the team slug in `iss`; iam.tf's trust policy and the
  # IdP in data.tf are both keyed on that URL.
  oidc_token_config = {
    issuer_mode = "team"
  }
}

resource "vercel_project_domain" "prod" {
  count = local.is_prod ? 1 : 0

  project_id = local.vercel_project_id
  domain     = local.prod_domain
}

# Only the Bedrock wiring lives here. Integration-injected vars (Neon, Blob,
# Upstash) and dashboard secrets (Better Auth, Inngest, Resend) stay where they are.
locals {
  vercel_env = {
    AWS_REGION = {
      value     = data.aws_region.current.region
      sensitive = false
    }
    AWS_ROLE_ARN = {
      value     = aws_iam_role.this.arn
      sensitive = false
    }
    BEDROCK_RECEIPT_MODEL = {
      value     = local.bedrock_receipt_model
      sensitive = false
    }
  }
}

resource "vercel_project_environment_variable" "this" {
  for_each = local.vercel_env

  project_id = local.vercel_project_id
  key        = each.key
  value      = each.value.value
  target     = [var.environment]
  sensitive  = each.value.sensitive
}

# Deployment Protection bypass secret. deploy.yml reads it from Terraform output
# and sends it as the `x-vercel-protection-bypass` header so the promote gate can
# curl /api/health on the staged (SSO-protected) deployment before promoting.
# Prod-state only: the single project is owned by production state; preview reads
# the project via data.vercel_project and has no gate, so needs no bypass.
resource "vercel_project_protection_bypass" "this" {
  count = local.is_prod ? 1 : 0

  project_id = local.vercel_project_id
}
