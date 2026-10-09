import { describe, expect, it } from "vitest";
import { unstaged } from "~/test/fakes";
import type { MembersRepository } from "./members.repository";
import { MembersService } from "./members.service";

function serviceWith(staged: Partial<MembersRepository>) {
	const repository: MembersRepository = {
		findNames: unstaged,
		...staged,
	};
	return new MembersService({ repository });
}

describe("MembersService", () => {
	it("namesByIds maps each member id to its name", async () => {
		const service = serviceWith({
			findNames: async () => [
				{ id: "member-1", name: "Sam" },
				{ id: "member-2", name: "Alex" },
			],
		});

		const names = await service.namesByIds(["member-1", "member-2"]);

		expect([...names]).toEqual([
			["member-1", "Sam"],
			["member-2", "Alex"],
		]);
	});

	it("namesByIds has no entry for an id with no row", async () => {
		const service = serviceWith({
			findNames: async () => [{ id: "member-1", name: "Sam" }],
		});

		const names = await service.namesByIds(["member-1", "gone"]);

		expect(names.has("gone")).toBe(false);
	});

	it("namesByIds passes the ids to the repository unchanged", async () => {
		const calls: string[][] = [];
		const service = serviceWith({
			findNames: async (memberIds) => {
				calls.push(memberIds);
				return [];
			},
		});

		await service.namesByIds(["member-1", "member-2"]);

		expect(calls).toEqual([["member-1", "member-2"]]);
	});

	// No repository stub given: any query would throw.
	it("namesByIds gives an empty map for no ids without querying", async () => {
		const service = serviceWith({});

		await expect(service.namesByIds([])).resolves.toEqual(new Map());
	});
});
