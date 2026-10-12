terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.25.0"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.0"
    }
    posthog = {
      source  = "PostHog/posthog"
      version = "1.0.24"
    }
  }

  backend "s3" {
    region       = "ap-southeast-2"
    use_lockfile = true
  }
}
