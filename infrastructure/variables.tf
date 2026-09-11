variable "environment" {
  type        = string
  description = "Selects the state file, the Vercel env-var target and the IAM role name: production or preview."

  validation {
    condition     = contains(["production", "preview"], var.environment)
    error_message = "environment must be production or preview."
  }
}
