import { inArray } from "drizzle-orm";
import type { db as realDb } from "~/server/db";
import { user } from "./auth.schema";

export interface MemberNameRow {
	id: string;
	name: string;
}

// Reads only: better-auth owns every write to `user` (adr022).
export interface MembersRepository {
	findNames(memberIds: string[]): Promise<MemberNameRow[]>;
}

interface DrizzleMembersRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleMembersRepository implements MembersRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleMembersRepositoryDeps) {
		this.db = db;
	}

	findNames(memberIds: string[]): Promise<MemberNameRow[]> {
		return this.db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inArray(user.id, memberIds));
	}
}
