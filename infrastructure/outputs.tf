output "vercel_role_arn" {
  description = "IAM role the Vercel OIDC token is exchanged for. Terraform also writes it to the AWS_ROLE_ARN Vercel env var."
  value       = aws_iam_role.this.arn
}

output "vercel_project_id" {
  description = "Vercel project id (owned by the production state, read by preview)."
  value       = local.vercel_project_id
}

output "app_url" {
  description = "Where this apply's deployment is reachable. deploy.yml publishes it as the GitHub environment URL."
  value       = local.is_prod ? "https://${local.prod_domain}" : "https://${vercel_deployment.this.url}"
}
