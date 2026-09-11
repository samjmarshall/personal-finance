output "vercel_role_arn" {
  description = "IAM role the Vercel OIDC token is exchanged for. Terraform also writes it to the AWS_ROLE_ARN Vercel env var."
  value       = aws_iam_role.this.arn
}

output "vercel_project_id" {
  description = "Vercel project id (owned by the production state, read by preview)."
  value       = local.vercel_project_id
}

output "app_url" {
  description = "Production custom domain. deploy.yml publishes it as the GitHub environment URL after promote (the staged deployment URL is behind SSO)."
  value       = "https://${local.prod_domain}"
}

output "protection_bypass_secret" {
  description = "x-vercel-protection-bypass header value the promote gate uses to reach /api/health on the staged deployment. Prod-state only; null in preview."
  sensitive   = true
  value       = one(vercel_project_protection_bypass.this[*].secret)
}
