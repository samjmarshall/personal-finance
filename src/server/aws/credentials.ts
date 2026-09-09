import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/** Lazy credential resolver the Bedrock provider accepts as `credentialProvider`. */
export type AwsCredentialsProvider = ReturnType<typeof awsCredentialsProvider>;

/**
 * AWS credential source for Bedrock. Vercel + role ARN: OIDC token exchanged for
 * `roleArn` via sts:AssumeRoleWithWebIdentity. Otherwise undefined, so the SDK
 * reads AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN (what `assume` exports; no profile
 * or SSO chain, AWS_PROFILE alone does nothing). Lazy: nothing is fetched here.
 *
 * No `audience`: it would re-mint the token with that `aud`, but the trust policy
 * (infrastructure/iam.tf) expects Vercel's native team-mode `aud`. Gates on Vercel
 * presence, not VERCEL_OIDC_TOKEN: that env var exists only at build time; at
 * runtime the token comes per request in the x-vercel-oidc-token header.
 */
export function selectAwsCredentials({
	isVercel,
	roleArn,
}: {
	isVercel: boolean;
	roleArn?: string;
}): AwsCredentialsProvider | undefined {
	if (!isVercel || !roleArn) return undefined;
	return awsCredentialsProvider({ roleArn });
}
