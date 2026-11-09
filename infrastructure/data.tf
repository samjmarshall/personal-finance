data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

# The preview state reads the project the production state owns (vercel.tf).
data "vercel_project" "this" {
  count = local.is_prod ? 0 : 1

  name = local.project
}

# Read, never created: the IdP is made once by hand (docs/infrastructure.md) so
# preview, which applies before production, never waits on production to own it.
# The issuer URL carries the team slug, so renaming the Vercel team needs a new IdP.
data "aws_iam_openid_connect_provider" "vercel" {
  url = "https://${local.vercel_oidc_issuer}"
}
