data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

# The preview state reads the project the production state owns (vercel.tf).
data "vercel_project" "this" {
  count = local.is_prod ? 0 : 1

  name = local.project
}

# AWS allows one IdP per issuer URL per account and ai-insurance-claims already
# created this one; creating it again would fail with EntityAlreadyExists.
data "aws_iam_openid_connect_provider" "vercel" {
  url = "https://${local.vercel_oidc_issuer}"
}
