import { describe, expect, it } from "vitest";
import { selectAwsCredentials } from "./credentials";

const ROLE_ARN = "arn:aws:iam::123456789012:role/vercel-oidc";

describe("selectAwsCredentials", () => {
	it("returns the OIDC provider closure when on Vercel with a role ARN", () => {
		const provider = selectAwsCredentials({
			isVercel: true,
			roleArn: ROLE_ARN,
		});
		// A resolved provider is a lazy credential-resolver function.
		expect(typeof provider).toBe("function");
	});

	it("returns undefined (env-var credentials) when not on Vercel", () => {
		expect(
			selectAwsCredentials({ isVercel: false, roleArn: ROLE_ARN }),
		).toBeUndefined();
	});

	it("returns undefined when on Vercel but the role ARN is absent", () => {
		expect(
			selectAwsCredentials({ isVercel: true, roleArn: undefined }),
		).toBeUndefined();
	});

	it("returns undefined when on Vercel but the role ARN is empty", () => {
		expect(
			selectAwsCredentials({ isVercel: true, roleArn: "" }),
		).toBeUndefined();
	});

	it("selection is lazy: no token read or network call at construction", () => {
		// No VERCEL_OIDC_TOKEN is set in this test process. If selection eagerly
		// read the token or hit STS it would throw here; instead it must hand back
		// an un-invoked closure that only resolves credentials at send() time.
		const saved = process.env.VERCEL_OIDC_TOKEN;
		delete process.env.VERCEL_OIDC_TOKEN;
		try {
			const provider = selectAwsCredentials({
				isVercel: true,
				roleArn: ROLE_ARN,
			});
			expect(typeof provider).toBe("function");
		} finally {
			if (saved !== undefined) process.env.VERCEL_OIDC_TOKEN = saved;
		}
	});
});
