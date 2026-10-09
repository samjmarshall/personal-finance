import { describe, expect, it } from "vitest";

import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const router = createTRPCRouter({
	memberId: protectedProcedure.query(({ ctx }) => ctx.session.user.id),
	context: protectedProcedure.query(({ ctx }) => ({
		services: ctx.services,
		db: ctx.db,
	})),
});

describe("createTestCaller", () => {
	it("runs a protected procedure as a Member by default", async () => {
		await expect(createTestCaller(router).memberId()).resolves.toBe("member-1");
	});

	it("rejects with UNAUTHORIZED when signed out", async () => {
		await expect(
			createTestCaller(router, { session: null }).memberId(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("hands the given services to the procedure as ctx.services", async () => {
		const services = {};

		const ctx = await createTestCaller(router, { services }).context();

		expect(ctx.services).toBe(services);
	});

	it("leaves ctx.db unset so a procedure reading it fails loudly", async () => {
		const ctx = await createTestCaller(router).context();

		expect(ctx.db).toBeUndefined();
	});
});
