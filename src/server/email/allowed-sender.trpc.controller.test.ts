import { describe, expect, it } from "vitest";
import type { AllowedSender, AllowedSenderListItem } from "~/domain/email";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { recorder, throwing } from "~/test/fakes";
import type { AllowedSenderService } from "./allowed-sender.service";
import { allowedSenderRouter } from "./allowed-sender.trpc.controller";

const router = createTRPCRouter({ allowedSender: allowedSenderRouter });

function callerWith(
	allowedSenders: Partial<AllowedSenderService>,
	session?: { user: { id: string } } | null,
) {
	return createTestCaller(router, { services: { allowedSenders }, session });
}

type Caller = ReturnType<typeof callerWith>["allowedSender"];

const SENDER = {
	id: 1,
	email: "sam@example.com",
	userId: "member-1",
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
} satisfies AllowedSender;

describe("allowedSender router", () => {
	it("list hands the service the session's member id and returns its items", async () => {
		const items: AllowedSenderListItem[] = [
			{ ...SENDER, userName: "Sam", isOwn: true },
		];
		const { method, calls } = recorder(items);

		await expect(
			callerWith({ list: method }).allowedSender.list(),
		).resolves.toEqual(items);
		expect(calls).toEqual([["member-1"]]);
	});

	it("add hands the service the session's member id and the parsed email", async () => {
		const { method, calls } = recorder(SENDER);

		await expect(
			callerWith({ add: method }).allowedSender.add({
				email: "  Sam@Example.COM  ",
			}),
		).resolves.toEqual(SENDER);
		expect(calls).toEqual([["member-1", "sam@example.com"]]);
	});

	// The owner filter on the delete is only as good as the member id it gets. That
	// id must come from the session, never the input, and the type checker cannot
	// catch a wrong one being passed (design § Testing).
	it("remove hands the service the session's member id, not one from the input", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith(
				{ remove: method },
				{ user: { id: "member-2" } },
			).allowedSender.remove({ id: 1 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([["member-2", 1]]);
	});

	it("surfaces a ConflictError as CONFLICT", async () => {
		const add = throwing(
			new ConflictError("That address is already on the allowlist."),
		);

		await expect(
			callerWith({ add }).allowedSender.add({ email: "sam@example.com" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That address is already on the allowlist.",
		});
	});

	it("surfaces a NotFoundError as NOT_FOUND", async () => {
		const remove = throwing(
			new NotFoundError("That address is not on your allowlist."),
		);

		await expect(
			callerWith({ remove }).allowedSender.remove({ id: 99 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "That address is not on your allowlist.",
		});
	});

	it("rejects a malformed address before reaching the service", async () => {
		const { method, calls } = recorder(SENDER);

		await expect(
			callerWith({ add: method }).allowedSender.add({ email: "not-an-email" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it.each([
		["list", (a: Caller) => a.list()],
		["add", (a: Caller) => a.add({ email: "sam@example.com" })],
		["remove", (a: Caller) => a.remove({ id: 1 })],
	])(
		"rejects a signed-out %s before reaching the service",
		async (_name, call) => {
			const list = recorder([]);
			const add = recorder(SENDER);
			const remove = recorder(undefined);
			const caller = callerWith(
				{ list: list.method, add: add.method, remove: remove.method },
				null,
			).allowedSender;

			await expect(call(caller)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			});
			expect([list.calls, add.calls, remove.calls]).toEqual([[], [], []]);
		},
	);
});
