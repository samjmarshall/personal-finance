import { auth } from "./config";

/** The signed-in member behind a request, for entry points that sit outside tRPC. */
export interface SessionReader {
	memberId(headers: Headers): Promise<string | undefined>;
}

export class BetterAuthSessionReader implements SessionReader {
	async memberId(headers: Headers): Promise<string | undefined> {
		const session = await auth.api.getSession({ headers });
		return session?.user.id;
	}
}
