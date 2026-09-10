---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-09-09'
# prettier-ignore
---

# Receipt extraction calls Claude on Amazon Bedrock, authenticated by Vercel OIDC into a per-environment IAM role

## Context

The `process-receipt` worker called the Anthropic API directly through `@ai-sdk/anthropic`, authenticated by a long-lived `ANTHROPIC_API_KEY` pasted into the Vercel dashboard. The key was shared by production and every preview, lived outside any infrastructure code, and the model id was a constant in `src/server/receipts/extraction.ts`, so changing models meant a code change and a deploy.

Receipt images are household financial data; keeping inference in Australia and billing on the existing AWS account were both wanted. Vercel can mint an OIDC token per deployment whose subject names the team, project and environment, and AWS can exchange that token for short-lived role credentials. How should the app reach Claude, and how should it authenticate?

## Decision

We will call Claude through Amazon Bedrock with `@ai-sdk/amazon-bedrock`, authenticated on Vercel by exchanging the deployment's OIDC token for the IAM role in `AWS_ROLE_ARN` (`@vercel/oidc-aws-credentials-provider`, wired in `src/server/aws/credentials.ts`). Terraform ([adr013](adr013-terraform-owned-vercel-deployments.md)) creates one role per environment — `personal-finance-production`, `personal-finance-preview` — whose trust is scoped to `owner:rekurve:project:personal-finance:environment:<env>`, and whose policy grants `InvokeModel`/`InvokeModelWithResponseStream` on the `au.anthropic.claude-sonnet-4-6` inference profile plus the foundation-model wildcard it resolves to, gated by `bedrock:InferenceProfileArn`.

The model id is data: Terraform writes it to the `BEDROCK_RECEIPT_MODEL` env var from one local, and switching models is editing `bedrock_receipt_model` and `bedrock_foundation_model` in `infrastructure/locals.tf` and pushing. Locally there is no role; `assume <profile>` exports static credentials the provider reads from the environment. The worker takes its `LanguageModel` by injection and is wired to Bedrock once, in `src/server/inngest/functions.ts`.

## Consequences

- No long-lived AI credential exists anywhere; every call uses STS credentials scoped to one environment.
- Bedrock's Converse API caps a message at 3.75 MB per image and 4.5 MB per document, below the app's 10 MB upload limit. The worker refuses oversize bytes before the call and parks the receipt as "too large"; shrinking images client-side is future work.
- `@ai-sdk/amazon-bedrock` has no default credential chain — `AWS_PROFILE` alone does nothing. Local dev must `assume` first, which is one more step than an API key.
- A bare `anthropic.*` model id is not invocable on Bedrock; only the `au.` inference profile is, so the `au.` prefix is load-bearing, not cosmetic. `apac.` would let inference leave Australia.
- Claude Sonnet 4.6 on Bedrock is on the SDK's list of models without reliable native structured output, so `generateObject` falls back to tool-mode JSON. Extraction quality was not observed to change, but the path differs from the direct API.
- New Anthropic models reach Bedrock later than the Anthropic API and need an AU inference profile and a model-access grant before the locals can be flipped.
- Provider lock-in moves from the Anthropic API to AWS. The worker is provider-agnostic, so reverting is `src/server/aws/bedrock.ts` plus env vars; `@ai-sdk/anthropic` remains installed as a transitive dependency of the Bedrock provider.
- Non-retryable Bedrock errors (400 `ValidationException`, 403 `AccessDenied`) are parked at once with copy that does not say "retry".

## Links

- Related: [adr013](adr013-terraform-owned-vercel-deployments.md) — Terraform delivers the role and env vars
- Runbook: [infrastructure](../infrastructure.md) — model switch, local credentials
- Vendor docs: [Bedrock `Message` content limits](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html), [Vercel OIDC → AWS](https://vercel.com/docs/oidc/aws)
