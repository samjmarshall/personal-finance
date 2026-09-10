locals {
  bedrock_receipt_profile_arn = "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${local.bedrock_receipt_model}"
}

data "aws_iam_policy_document" "bedrock" {
  statement {
    actions = [
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:InvokeModel"
    ]
    resources = [local.bedrock_receipt_profile_arn]
  }

  statement {
    actions = [
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:InvokeModel"
    ]
    # The profile fans out to dated foundation-model versions, hence the wildcard.
    # The condition keeps it least-privilege: only calls routed through our
    # receipt profile may touch them.
    resources = [
      "arn:aws:bedrock:*::foundation-model/${local.bedrock_foundation_model}*"
    ]
    condition {
      test     = "StringLike"
      variable = "bedrock:InferenceProfileArn"
      values   = [local.bedrock_receipt_profile_arn]
    }
  }
}

data "aws_iam_policy_document" "vercel_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.vercel.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.vercel_oidc_issuer}:aud"
      values   = [local.vercel_oidc_audience]
    }

    # One role per Vercel environment, so a preview deployment can never present
    # a token that assumes the production role.
    condition {
      test     = "StringLike"
      variable = "${local.vercel_oidc_issuer}:sub"
      values   = ["owner:${local.vercel_team_slug}:project:${local.project}:environment:${var.environment}"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${local.project}-${var.environment}"
  description        = "Assumed by Vercel (${var.environment}) deployments via OIDC for Bedrock access."
  assume_role_policy = data.aws_iam_policy_document.vercel_trust.json
}

resource "aws_iam_role_policy" "bedrock" {
  name   = "${local.project}-${var.environment}"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.bedrock.json
}
