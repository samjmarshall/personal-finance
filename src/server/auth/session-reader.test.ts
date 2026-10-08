import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({
	getSession:
		vi.fn<
			(opts: { headers: Headers }) => Promise<{ user: { id: string } } | null>
		>(),
}));
vi.mock("./config", () => ({ auth: { api: { getSession } } }));

const { BetterAuthSessionReader } = await import("./session-reader");

beforeEach(() => vi.clearAllMocks());

describe("BetterAuthSessionReader.memberId", () => {
	it("returns the signed-in member's id, reading the headers it was given", async () => {
		getSession.mockResolvedValue({ user: { id: "member-1" } });
		const headers = new Headers({ cookie: "session=abc" });

		await expect(new BetterAuthSessionReader().memberId(headers)).resolves.toBe(
			"member-1",
		);
		expect(getSession).toHaveBeenCalledWith({ headers });
	});

	it("returns undefined when signed out", async () => {
		getSession.mockResolvedValue(null);

		await expect(
			new BetterAuthSessionReader().memberId(new Headers()),
		).resolves.toBeUndefined();
	});
});
