import { and, asc, eq } from "drizzle-orm";
import type { AllowedSender } from "~/domain/allowed-senders";
import type { db as realDb } from "~/server/db";
import { allowedSenders } from "./allowed-senders.schema";

// Takes the glossary's memberId; the column keeps better-auth's userId.
export interface AllowedSendersRepository {
	list(): Promise<AllowedSender[]>;
	insert(memberId: string, email: string): Promise<AllowedSender | undefined>;
	/** `undefined` when no row matched — absent or another Member's. */
	deleteOwn(memberId: string, id: number): Promise<{ id: number } | undefined>;
	/** `email` must already be bare + lower-cased — the shape the allowlist stores. */
	findMemberId(email: string): Promise<string | undefined>;
}

interface DrizzleAllowedSendersRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleAllowedSendersRepository
	implements AllowedSendersRepository
{
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleAllowedSendersRepositoryDeps) {
		this.db = db;
	}

	list(): Promise<AllowedSender[]> {
		return this.db
			.select()
			.from(allowedSenders)
			.orderBy(asc(allowedSenders.email));
	}

	async insert(
		memberId: string,
		email: string,
	): Promise<AllowedSender | undefined> {
		const [row] = await this.db
			.insert(allowedSenders)
			.values({ email, userId: memberId })
			.returning();
		return row;
	}

	async deleteOwn(
		memberId: string,
		id: number,
	): Promise<{ id: number } | undefined> {
		// One scoped statement: another member's row matches nothing, so it looks
		// the same as a missing one and leaks no ownership.
		const [row] = await this.db
			.delete(allowedSenders)
			.where(
				and(eq(allowedSenders.id, id), eq(allowedSenders.userId, memberId)),
			)
			.returning({ id: allowedSenders.id });
		return row;
	}

	async findMemberId(email: string): Promise<string | undefined> {
		const [sender] = await this.db
			.select({ userId: allowedSenders.userId })
			.from(allowedSenders)
			.where(eq(allowedSenders.email, email))
			.limit(1);
		return sender?.userId;
	}
}
