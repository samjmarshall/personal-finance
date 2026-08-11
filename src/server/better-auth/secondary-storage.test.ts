import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	get: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
	incr: vi.fn(),
	expire: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
	Redis: vi.fn(function Redis() {
		return client;
	}),
}));

import { createSecondaryStorage } from "./secondary-storage";

const storage = () =>
	createSecondaryStorage({ url: "https://kv", token: "t", prefix: "ba:test:" });

beforeEach(() => {
	for (const fn of Object.values(client)) fn.mockReset();
});

describe("get", () => {
	it("re-stringifies an object the REST client already parsed", async () => {
		client.get.mockResolvedValue({ session: { id: "abc" } });

		await expect(storage().get("token")).resolves.toBe(
			'{"session":{"id":"abc"}}',
		);
	});

	it("returns null when the client throws, so Postgres fallback runs", async () => {
		client.get.mockRejectedValue(new Error("upstash down"));

		await expect(storage().get("token")).resolves.toBeNull();
	});

	// Bulk revocation derives the tokens to delete from this key alone, then drops the
	// Postgres rows regardless. A swallowed miss revokes nothing and reports success.
	it("propagates a throw for the active-sessions manifest", async () => {
		client.get.mockRejectedValue(new Error("upstash down"));

		await expect(storage().get("active-sessions-usr_42")).rejects.toThrow(
			"upstash down",
		);
	});
});

describe("set", () => {
	it("passes the TTL as `ex`, which Upstash reads as seconds", async () => {
		await storage().set("token", "value", 604800);

		expect(client.set).toHaveBeenCalledWith("ba:test:token", "value", {
			ex: 604800,
		});
	});

	it("omits the options argument when no TTL is given", async () => {
		await storage().set("token", "value");

		expect(client.set).toHaveBeenCalledWith("ba:test:token", "value");
	});

	it("swallows a throw — Postgres already holds the durable row", async () => {
		client.set.mockRejectedValue(new Error("upstash down"));

		await expect(storage().set("token", "value")).resolves.toBeUndefined();
	});

	// A lost manifest write is unrecoverable: the token is absent from the list forever,
	// so a later revoke misses it even against a healthy Redis. Fail sign-in instead.
	it("propagates a throw for the active-sessions manifest", async () => {
		client.set.mockRejectedValue(new Error("upstash down"));

		await expect(
			storage().set("active-sessions-usr_42", "[]", 60),
		).rejects.toThrow("upstash down");
	});
});

describe("delete", () => {
	// Swallowing this lets Better Auth drop the Postgres row while the Redis key
	// survives to authenticate for the rest of its TTL. See adr007.
	it("propagates a throw rather than failing open", async () => {
		client.del.mockRejectedValue(new Error("upstash down"));

		await expect(storage().delete("token")).rejects.toThrow("upstash down");
	});
});

describe("increment", () => {
	it("sets the TTL on the first count only, so the window does not slide", async () => {
		client.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
		const store = storage();

		await expect(store.increment("ip", 60)).resolves.toBe(1);
		expect(client.expire).toHaveBeenCalledWith("ba:test:ip", 60);

		await expect(store.increment("ip", 60)).resolves.toBe(2);
		expect(client.expire).toHaveBeenCalledTimes(1);
	});

	// 0 reads as under the limit. A throw would 500 every /api/auth/* request.
	it("returns 0 when the client throws", async () => {
		client.incr.mockRejectedValue(new Error("upstash down"));

		await expect(storage().increment("ip", 60)).resolves.toBe(0);
	});
});

describe("failure logging", () => {
	// @upstash/redis builds its message as `${body.error}, command was: ${JSON.stringify(
	// req.body)}` — the command carries the raw session token and the user record.
	const upstashError = () =>
		new Error(
			'ERR max daily request limit exceeded, command was: [["set","ba:test:sess_tok_SECRET","{\\"user\\":{\\"email\\":\\"victim@example.com\\"}}","ex",604800]]',
		);

	it("logs the reason without the command body Upstash appends", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		client.get.mockRejectedValue(upstashError());

		await storage().get("sess_tok_SECRET");

		const output = logged.mock.calls.flat().join(" ");
		expect(output).toContain("max daily request limit exceeded");
		expect(output).not.toContain("sess_tok_SECRET");
		expect(output).not.toContain("victim@example.com");
		logged.mockRestore();
	});

	// UpstashJSONParseError's message is `Unable to parse response body: <200 chars>`,
	// and on a successful GET that body is the stored session. Nothing here is safe.
	it("logs nothing but the name for a response-body parse failure", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const parseError = new Error(
			'Unable to parse response body: {"result":"{\\"session\\":{\\"token\\":\\"sess_tok_SECRET\\"}}"}',
		);
		parseError.name = "UpstashJSONParseError";
		client.get.mockRejectedValue(parseError);

		await storage().get("sess_tok_SECRET");

		const output = logged.mock.calls.flat().join(" ");
		expect(output).toContain("UpstashJSONParseError");
		expect(output).not.toContain("sess_tok_SECRET");
		logged.mockRestore();
	});
});

// The prefix isolates environments and databases from each other. A method that
// skips it reads a neighbouring deployment's sessions.
describe("prefixing", () => {
	it("applies the injected prefix to every method", async () => {
		client.incr.mockResolvedValue(1);
		const store = createSecondaryStorage({
			url: "https://kv",
			token: "t",
			prefix: "ba:preview:deadbeef:",
		});

		await store.get("k");
		await store.set("k", "v");
		await store.delete("k");
		await store.increment("k", 60);

		const keyed = [
			client.get,
			client.set,
			client.del,
			client.incr,
			client.expire,
		];
		for (const fn of keyed) {
			expect(fn.mock.calls[0]?.[0]).toBe("ba:preview:deadbeef:k");
		}
	});
});
