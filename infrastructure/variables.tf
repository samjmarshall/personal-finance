variable "environment" {
  type        = string
  description = "Selects the state file, the Vercel env-var target and the IAM role name: production or preview."

  validation {
    condition     = contains(["production", "preview"], var.environment)
    error_message = "environment must be production or preview."
  }
}

variable "posthog_key" {
  type        = string
  sensitive   = true
  description = "PostHog project token (phc_…) for the Rekurve project; same value for production and preview."
}
