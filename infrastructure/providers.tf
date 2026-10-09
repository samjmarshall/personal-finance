provider "aws" {
  region = "ap-southeast-2"

  default_tags {
    tags = {
      "Environment" = var.environment
      "Project"     = local.project
      "ManagedBy"   = local.github_repo
    }
  }
}

provider "vercel" {
  team = local.vercel_team_slug # api_token is read from the VERCEL_API_TOKEN env var
}

provider "posthog" {
  project_id = var.posthog_project_id # api_key is read from the POSTHOG_API_KEY env var
}

# The Price List API is only served from us-east-1, ap-south-1 and eu-central-1.
# Data-only (pricing.tf): every resource stays on the default provider.
provider "aws" {
  alias  = "pricing"
  region = "us-east-1"
}
