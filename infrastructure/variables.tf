variable "environment" {
  type        = string
  description = "Selects the state file, the Vercel env-var target and the IAM role name: production or preview."

  validation {
    condition     = contains(["production", "preview"], var.environment)
    error_message = "environment must be production or preview."
  }
}

variable "deploy_ref" {
  type        = string
  description = "Git branch to deploy. Vercel stamps it as meta.githubCommitRef, which the Neon integration (preview/<branch> DB) and teardown.yml key on. Defaults to main so a local plan/apply needs no flags."
  default     = "main"
}

variable "deploy_sha" {
  type        = string
  description = "Commit SHA of the push. Never sent to Vercel; it only feeds terraform_data.deploy_sha so a new SHA replaces vercel_deployment. Empty (local) means no forced redeploy."
  default     = ""
}
