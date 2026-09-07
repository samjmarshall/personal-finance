import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { settingRouter } = await import("./setting");
const { appSettings } = await import("~/server/settings/settings.schema");
const { FORTNIGHT_ANCHOR_KEY } = await import(
	"~/server/settings/settings.constants"
);

function caller(db: unknown) {
	return createCallerFactory(settingRouter)({
		db,
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);
}

// Fake db whose insert().values().onConflictDoUpdate().returning() yields the given
// rows, recording what the upsert was handed so the test can assert the key/value.
// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
function upsertDb(returning: any[]) {
	// biome-ignore lint/suspicious/noExplicitAny: captured drizzle call args.
	const captured: { values?: any; conflict?: any } = {};
	return {
		captured,
		db: {
			insert: () => ({
				// biome-ignore lint/suspicious/noExplicitAny: captured drizzle call args.
				values: (v: any) => {
					captured.values = v;
					return {
						// biome-ignore lint/suspicious/noExplicitAny: captured drizzle call args.
						onConflictDoUpdate: (c: any) => {
							captured.conflict = c;
							return { returning: async () => returning };
						},
					};
				},
			}),
		},
	};
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("setting.setFortnightAnchor", () => {
	it("upserts the anchor under the shared key and returns the stored string", async () => {
		const { captured, db } = upsertDb([{ value: "2026-08-26" }]);

		const result = await caller(db).setFortnightAnchor({ value: "2026-08-26" });

		expect(captured.values).toEqual({
			key: FORTNIGHT_ANCHOR_KEY,
			value: "2026-08-26",
		});
		expect(captured.conflict.target).toBe(appSettings.key);
		expect(captured.conflict.set).toEqual({ value: "2026-08-26" });
		// A Date over the wire would re-read a day early for behind-UTC members —
		// the drift the query's string contract exists to avoid.
		expect(result).toBe("2026-08-26");
		expect(typeof result).toBe("string");
	});

	it("raises INTERNAL_SERVER_ERROR when the upsert returns no row", async () => {
		const { db } = upsertDb([]);

		await expect(
			caller(db).setFortnightAnchor({ value: "2026-08-26" }),
		).rejects.toMatchObject(
			new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to set fortnight anchor.",
			}),
		);
	});

	it("rejects a malformed date before it reaches the db", async () => {
		const { captured, db } = upsertDb([{ value: "2026-02-30" }]);

		await expect(
			caller(db).setFortnightAnchor({ value: "2026-02-30" }),
		).rejects.toThrow();
		expect(captured.values).toBeUndefined();
	});
});
