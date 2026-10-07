import { describe, expect, it } from "vitest";
import type { AllowedSender } from "~/domain/email";
import type { MembersService } from "~/server/auth/members.service";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import {
	expectPlainError,
	failedQuery,
	recorder,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { AllowedSenderRepository } from "./allowed-sender.repository";
import { AllowedSenderService } from "./allowed-sender.service";

type Members = Pick<MembersService, "namesByIds">;

function serviceWith(
	staged: Partial<AllowedSenderRepository>,
	members: Partial<Members> = {},
) {
	const repository: AllowedSenderRepository = {
		list: unstaged,
		insert: unstaged,
		deleteOwn: unstaged,
		...staged,
	};
	return new AllowedSenderService({
		repository,
		members: { namesByIds: unstaged, ...members },
	});
}

const SAM_SENDER = {
	id: 1,
	email: "sam@example.com",
	userId: "member-1",
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
} satisfies AllowedSender;

const ALEX_SENDER = {
	id: 2,
	email: "shop@example.com",
	userId: "member-2",
	createdAt: new Date("2026-09-02T01:00:00.000Z"),
} satisfies AllowedSender;

const NAMES = new Map([
	["member-1", "Sam"],
	["member-2", "Alex"],
]);

describe("AllowedSenderService.list", () => {
	it("merges each owner's name and flags the caller's own rows", async () => {
		const service = serviceWith(
			{ list: async () => [SAM_SENDER, ALEX_SENDER] },
			{ namesByIds: async () => NAMES },
		);

		await expect(service.list("member-1")).resolves.toEqual([
			{ ...SAM_SENDER, userName: "Sam", isOwn: true },
			{ ...ALEX_SENDER, userName: "Alex", isOwn: false },
		]);
	});

	it("flags ownership against the given member, not a fixed one", async () => {
		const service = serviceWith(
			{ list: async () => [SAM_SENDER, ALEX_SENDER] },
			{ namesByIds: async () => NAMES },
		);

		const items = await service.list("member-2");

		expect(items.map((item) => item.isOwn)).toEqual([false, true]);
	});

	it("gives a null userName when the owner has no name", async () => {
		const service = serviceWith(
			{ list: async () => [ALEX_SENDER] },
			{ namesByIds: async () => new Map() },
		);

		await expect(service.list("member-1")).resolves.toEqual([
			{ ...ALEX_SENDER, userName: null, isOwn: false },
		]);
	});

	it("looks names up once, with each owner once", async () => {
		const { method, calls } = recorder(NAMES);
		const service = serviceWith(
			{ list: async () => [SAM_SENDER, { ...SAM_SENDER, id: 3 }] },
			{ namesByIds: method },
		);

		await service.list("member-1");

		expect(calls).toEqual([[["member-1"]]]);
	});

	// namesByIds is left unstaged, so a lookup here would throw.
	it("gives an empty list without a name lookup when no addresses are allowed", async () => {
		const service = serviceWith({ list: async () => [] });

		await expect(service.list("member-1")).resolves.toEqual([]);
	});
});

describe("AllowedSenderService.add", () => {
	it("inserts the address against the member and returns the stored row", async () => {
		const { method, calls } = recorder(SAM_SENDER);
		const service = serviceWith({ insert: method });

		await expect(service.add("member-1", "sam@example.com")).resolves.toEqual(
			SAM_SENDER,
		);
		expect(calls).toEqual([["member-1", "sam@example.com"]]);
	});

	it("turns a unique violation into a ConflictError", async () => {
		const error = failedQuery("23505");
		const service = serviceWith({ insert: throwing(error) });

		const thrown = await service
			.add("member-1", "sam@example.com")
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: "That address is already on the allowlist.",
			cause: error,
		});
	});

	it("lets any other driver error through unchanged", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ insert: throwing(error) });

		await expect(service.add("member-1", "sam@example.com")).rejects.toBe(
			error,
		);
	});

	it("throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		const thrown = await service
			.add("member-1", "sam@example.com")
			.catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to add allowed sender.");
	});
});

describe("AllowedSenderService.remove", () => {
	it("deletes the member's own row", async () => {
		const { method, calls } = recorder({ id: 1 });
		const service = serviceWith({ deleteOwn: method });

		await expect(service.remove("member-1", 1)).resolves.toBeUndefined();
		expect(calls).toEqual([["member-1", 1]]);
	});

	it("throws NotFoundError when no row of the member's matched", async () => {
		const service = serviceWith({ deleteOwn: async () => undefined });

		const thrown = await service
			.remove("member-1", 99)
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({
			message: "That address is not on your allowlist.",
		});
	});
});
