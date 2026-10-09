# Per-token Bedrock prices for the model in locals.tf, read from the live AWS
# Price List at plan time and published as BEDROCK_*_TOKEN_PRICE_USD (vercel.tf).
# PostHog cannot reliably price an inference-profile id, so the app stamps these
# onto ai.* spans as the custom price (adr015). The data source fails the plan on
# zero or several matching rows, so a stale model identity can't ship a price.
locals {
  # `au.` bills at the geographic tier: the usagetypes without the `_Global`
  # suffix. Indexing (no default) fails the plan in an unmapped region.
  bedrock_pricing_region_prefix = { "ap-southeast-2" = "APS2" }[data.aws_region.current.region]
  bedrock_pricing_usagetype = {
    for k in ["input", "output"] :
    k => "${local.bedrock_pricing_region_prefix}-MP:${local.bedrock_pricing_region_prefix}_${title(k)}TokenCount-Units"
  }
}

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
  # Terms and price dimensions are keyed by opaque SKU ids; the precondition
  # below requires exactly one of each, so no price tier is silently dropped.
  bedrock_on_demand_terms = {
    for k, product in data.aws_pricing_product.bedrock_token :
    k => values(jsondecode(product.result).terms.OnDemand)
  }
  bedrock_price_dimension = {
    for k, terms in local.bedrock_on_demand_terms :
    k => values(terms[0].priceDimensions)[0]
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
      condition     = alltrue([for terms in values(local.bedrock_on_demand_terms) : length(terms) == 1 && length(terms[0].priceDimensions) == 1])
      error_message = "Bedrock Price List row no longer has exactly one OnDemand term with one price dimension; pricing.tf would read only the first."
    }
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
