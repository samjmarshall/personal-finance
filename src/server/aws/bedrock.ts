import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { env } from "~/env";
import { selectAwsCredentials } from "./credentials";

// Vercel: OIDC token exchanged for AWS_ROLE_ARN. Local: undefined, so the provider
// reads the AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN that `assume <profile>` exports.
export const bedrock = createAmazonBedrock({
	region: env.AWS_REGION,
	credentialProvider: selectAwsCredentials({
		isVercel: !!process.env.VERCEL,
		roleArn: env.AWS_ROLE_ARN,
	}),
});
