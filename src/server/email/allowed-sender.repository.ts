import { and, asc, eq } from "drizzle-orm";
import type { AllowedSender } from "~/domain/email";
import type { db as realDb } from "~/server/db";
import { allowedSenders } from "./allowed-sender.schema";

// Takes the glossary's memberId; the column keeps better-auth's userId.
export interface AllowedSenderRepository {
	list(): Promise<AllowedSender[]>;
	insert(memberId: string, email: string): Promise<AllowedSender | undefined>;
	/** `undefined` when no row matched — absent or another Member's. */
	deleteOwn(memberId: string, id: number): Promise<{ id: number } | undefined>;
}

interface DrizzleAllowedSenderRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleAllowedSenderRepository implements AllowedSenderRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleAllowedSenderRepositoryDeps) {
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
		// Delete-or-404 in one statement, per the receipt router. Another member's
		// id matches no row under this filter and so 404s, which also keeps the
		// response identical whether it is absent or merely not theirs.
		const [row] = await this.db
			.delete(allowedSenders)
			.where(
				and(eq(allowedSenders.id, id), eq(allowedSenders.userId, memberId)),
			)
			.returning({ id: allowedSenders.id });
		return row;
	}
}
