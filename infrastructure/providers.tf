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
