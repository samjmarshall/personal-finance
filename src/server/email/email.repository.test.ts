import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DrizzleEmailRepository } from "./email.repository";

const dialect = new PgDialect();
const render = (cond: unknown) =>
	// biome-ignore lint/suspicious/noExplicitAny: dialect renders a drizzle SQL condition to text.
	dialect.sqlToQuery(cond as any).sql;

// Chain-capturing fake db for the allowlist read.
function harness({ senders = [] }: { senders?: { userId: string }[] } = {}) {
	let selectWhere: unknown;
	let limitArg: number | undefined;

	const db = {
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					selectWhere = cond;
					return {
						limit: (n: number) => {
							limitArg = n;
							return Promise.resolve(senders);
						},
					};
				},
			}),
		}),
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		repository: new DrizzleEmailRepository({ db: db as any }),
		getSelectWhere: () => selectWhere,
		getLimit: () => limitArg,
	};
}

describe("DrizzleEmailRepository", () => {
	describe("findAllowedSender", () => {
		it("returns the owner of a listed address, looking up by email with limit 1", async () => {
			const h = harness({ senders: [{ userId: "u1" }] });

			await expect(
				h.repository.findAllowedSender("sam@example.com"),
			).resolves.toEqual({ userId: "u1" });
			expect(render(h.getSelectWhere())).toContain('"email" =');
			expect(h.getLimit()).toBe(1);
		});

		it("returns undefined for an unlisted address", async () => {
			const h = harness();

			await expect(
				h.repository.findAllowedSender("nobody@example.com"),
			).resolves.toBeUndefined();
		});
	});
});
