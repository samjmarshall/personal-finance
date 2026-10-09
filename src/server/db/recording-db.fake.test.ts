import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordingDb } from "./recording-db.fake";

describe("recordingDb transaction", () => {
	it("records statements on the transaction between begin and commit", async () => {
		const { db, queries } = recordingDb();

		await db.transaction((tx) => tx.execute(sql`select 1`));

		expect(queries.map(({ sql }) => sql)).toEqual([
			"begin",
			"select 1",
			"commit",
		]);
	});

	it("fails a statement sent to the root db while a transaction is open", async () => {
		const { db, queries } = recordingDb();

		await expect(
			db.transaction(() => db.execute(sql`select 1`)),
		).rejects.toMatchObject({
			cause: { message: "ran outside the transaction: select 1" },
		});
		expect(queries.map(({ sql }) => sql)).toEqual(["begin", "rollback"]);
	});

	it("serves the root db again once the transaction ends", async () => {
		const { db, queries } = recordingDb();

		await db.transaction(async () => {});
		await db.execute(sql`select 1`);

		expect(queries.map(({ sql }) => sql)).toEqual([
			"begin",
			"commit",
			"select 1",
		]);
	});
});
