import { eq } from "drizzle-orm";
import type { db as realDb } from "~/server/db";
import { appSettings } from "./settings.schema";

export interface SettingRow {
	key: string;
	value: string;
}

// Generic by key: the table is key/value, and which key means what is the
// service's business.
export interface SettingsRepository {
	/** `undefined` when no row has the key. */
	findValue(key: string): Promise<string | undefined>;
	upsert(key: string, value: string): Promise<SettingRow | undefined>;
}

interface DrizzleSettingsRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleSettingsRepository implements SettingsRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleSettingsRepositoryDeps) {
		this.db = db;
	}

	async findValue(key: string): Promise<string | undefined> {
		const [row] = await this.db
			.select({ value: appSettings.value })
			.from(appSettings)
			.where(eq(appSettings.key, key));
		return row?.value;
	}

	async upsert(key: string, value: string): Promise<SettingRow | undefined> {
		const [row] = await this.db
			.insert(appSettings)
			.values({ key, value })
			.onConflictDoUpdate({ target: appSettings.key, set: { value } })
			.returning();
		return row;
	}
}
