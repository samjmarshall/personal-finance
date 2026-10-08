import { eq } from "drizzle-orm";

import type { db as realDb } from "~/server/db";
import { allowedSenders } from "./allowed-sender.schema";

/** Data tier for inbound-email ingestion: the allowlist read. */
export interface EmailRepository {
	/** `email` must already be bare + lower-cased — the shape the allowlist stores. */
	findAllowedSender(email: string): Promise<{ userId: string } | undefined>;
}

interface DrizzleEmailRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleEmailRepository implements EmailRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleEmailRepositoryDeps) {
		this.db = db;
	}

	async findAllowedSender(
		email: string,
	): Promise<{ userId: string } | undefined> {
		const [sender] = await this.db
			.select({ userId: allowedSenders.userId })
			.from(allowedSenders)
			.where(eq(allowedSenders.email, email))
			.limit(1);
		return sender;
	}
}
