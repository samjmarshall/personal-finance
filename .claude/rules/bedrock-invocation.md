---
paths:
  - "src/server/aws/**"
  - "src/server/receipts/**"
  - "infrastructure/**"
---

# Bedrock invocation

- **Invoke by inference-profile id, never a bare model id.** `au.anthropic.claude-sonnet-4-6` works; `anthropic.claude-sonnet-4-6` does not — Claude on Bedrock is only invocable through an inference profile. Use `au.`, not `apac.`: `au.` keeps inference in Australia, `apac.` may route elsewhere.
- **The model id is data, not code.** It reaches the app as `BEDROCK_RECEIPT_MODEL` (Vercel env var written by Terraform; `src/env.ts` default locally). To switch models edit **both** `bedrock_receipt_model` and `bedrock_foundation_model` in `infrastructure/locals.tf` — IAM grants the profile ARN *and* the foundation-model wildcard it resolves to, gated by `bedrock:InferenceProfileArn` — then push (`deploy.yml` applies). Never hardcode a model id in `src/`.
- **No default credential chain.** `@ai-sdk/amazon-bedrock` reads only `AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN` or the `credentialProvider` we pass. On Vercel that is the OIDC → `AWS_ROLE_ARN` exchange (`src/server/aws/credentials.ts`, gated on `VERCEL`, not on `VERCEL_OIDC_TOKEN`). Locally run `assume <profile>` first — `AWS_PROFILE` alone does nothing.
- **Payload caps are Bedrock's.** Converse: 3.75 MB per image, 4.5 MB per document, 100 PDF pages. Uploads accept 10 MB, so `receipt-extraction.service.ts` refuses oversize bytes before the call with a "too large" message. Keep that guard in step with any change to the upload limit.
- **Receipts tier stays provider-agnostic.** `ReceiptExtractionService` takes an injected `languageModel: LanguageModel` dep; the Bedrock provider (`bedrock(env.BEDROCK_RECEIPT_MODEL)`) is bound once in `src/server/inngest/functions.ts`. Don't import `~/server/aws/bedrock` anywhere under `src/server/receipts/` — the tests construct the service with a stub model and import it without env.
