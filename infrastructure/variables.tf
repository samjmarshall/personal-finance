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
  description = "PostHog project token (phc_…) for the project; same value for production and preview."

  # An unset secret arrives as "", which the app reads as "no key" and silently
  # turns off all telemetry. Fail the deploy instead.
  validation {
    condition     = startswith(var.posthog_key, "phc_")
    error_message = "posthog_key must be the phc_ project token (set the POSTHOG_KEY repo secret)."
  }
}

variable "posthog_project_id" {
  type        = string
  sensitive   = false
  description = "PostHog project ID for the project; same value for production and preview."

  # An unset repo var arrives as "", which the app reads as absent and silently
  # hides the receipt trace link. Fail the deploy instead.
  validation {
    condition     = can(regex("^[0-9]+$", var.posthog_project_id))
    error_message = "posthog_project_id must be the numeric PostHog project ID (set the POSTHOG_PROJECT_ID repo variable)."
  }
}
