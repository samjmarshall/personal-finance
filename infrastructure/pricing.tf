# Per-token Bedrock prices for the model in locals.tf, read from the live AWS
# Price List at plan time and published as BEDROCK_*_TOKEN_PRICE_USD (vercel.tf).
# PostHog cannot reliably price an inference-profile id, so the app stamps these
# onto ai.* spans as the custom price (adr015). The data source fails the plan on
# zero or several matching rows, so a stale model identity can't ship a price.
data "aws_pricing_product" "bedrock_token" {
  for_each = local.bedrock_pricing_usagetype
  provider = aws.pricing

  # AWS moves Claude between service codes (AmazonBedrockMarketplace until
  # 2026-10); `AmazonBedrock` holds only legacy models. A move fails the plan
  # with "did not return any elements" — find the new code with
  # `aws pricing describe-services --region us-east-1`.
  service_code = "AmazonBedrockFoundationModels"

  filters {
    field = "model"
    value = local.bedrock_pricing_model_name
  }
  filters {
    field = "regionCode"
    value = data.aws_region.current.region
  }
  filters {
    field = "feature"
    value = "On-demand Inference"
  }
  filters {
    field = "inferenceType"
    value = "${title(each.key)} tokens"
  }
  # Without this the Global row also matches.
  filters {
    field = "usagetype"
    value = each.value
  }
}

locals {
  # One OnDemand term with one price dimension, both keyed by opaque SKU ids.
  bedrock_price_dimension = {
    for k, product in data.aws_pricing_product.bedrock_token :
    k => values(values(jsondecode(product.result).terms.OnDemand)[0].priceDimensions)[0]
  }
  bedrock_usd_per_token = {
    for k, dimension in local.bedrock_price_dimension :
    k => tonumber(dimension.pricePerUnit.USD) / 1000000
  }
}

# Holds the last applied price in state, so a Price List change shows as a diff
# here and the env vars only ever get a value that passed these checks.
resource "terraform_data" "bedrock_token_prices" {
  input = local.bedrock_usd_per_token

  lifecycle {
    precondition {
      condition     = alltrue([for d in values(local.bedrock_price_dimension) : d.unit == "1M tokens"])
      error_message = "Bedrock Price List unit is no longer \"1M tokens\"; the per-token conversion in pricing.tf is wrong."
    }
    precondition {
      condition     = alltrue([for usd in values(local.bedrock_usd_per_token) : usd > 0])
      error_message = "Bedrock Price List returned a zero USD price."
    }
  }
}
