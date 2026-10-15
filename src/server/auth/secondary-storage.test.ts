import { errors } from "@upstash/redis";
import { makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({
	incr: vi.fn(),
	expire: vi.fn(),
	exec: vi.fn(),
}));

const client = vi.hoisted(() => ({
	get: vi.fn(),
	getdel: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
	pipeline: vi.fn(),
}));

vi.mock("@upstash/redis", async (importOriginal) => ({
	// The real error classes: the redaction below must stay pinned to the messages the
	// installed client actually produces, not to a string this file made up.
	errors: (await importOriginal<typeof import("@upstash/redis")>()).errors,
	Redis: vi.fn(function Redis() {
		return client;
	}),
}));

import { createSecondaryStorage } from "./secondary-storage";

const storage = () =>
	createSecondaryStorage({ url: "https://kv", token: "t", prefix: "ba:test:" });

let stdoutLines: string[];

beforeEach(() => {
	for (const fn of Object.values(client)) fn.mockReset();
	for (const fn of Object.values(pipeline)) fn.mockReset();
	client.pipeline.mockReturnValue(pipeline);
	pipeline.incr.mockReturnValue(pipeline);
	pipeline.expire.mockReturnValue(pipeline);
	pipeline.exec.mockResolvedValue([1, 1]);
	// The logger writes redacted JSON to stdout. Capture it (restored in afterEach)
	// so the fail-open cases stay off real stdout and the redaction is assertable.
	stdoutLines = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		if (typeof chunk === "string") stdoutLines.push(chunk);
		return true;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

const loggedOutput = () => stdoutLines.join(" ");

describe("get", () => {
	it("re-stringifies an object the REST client already parsed", async () => {
		client.get.mockResolvedValue({ session: { id: "abc" } });

		await expect(storage().get("token")).resolves.toBe(
			'{"session":{"id":"abc"}}',
		);
	});

	// The branch adr006's durability promise rests on: a miss must read as a miss so
	// Better Auth falls through to Postgres instead of resolving the user signed-out.
	it("returns null on a plain cache miss", async () => {
		client.get.mockResolvedValue(null);

		await expect(storage().get("token")).resolves.toBeNull();
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
			"get failed",
		);
	});
});

describe("getAndDelete", () => {
	// One GETDEL, so a single-use value can't be read twice between a GET and a DEL.
	it("consumes with one GETDEL and re-stringifies a parsed object", async () => {
		client.getdel.mockResolvedValue({ value: "otp" });

		await expect(storage().getAndDelete("verification:x")).resolves.toBe(
			'{"value":"otp"}',
		);
		expect(client.getdel).toHaveBeenCalledWith("ba:test:verification:x");
	});

	it("returns null on a miss", async () => {
		client.getdel.mockResolvedValue(null);

		await expect(storage().getAndDelete("verification:x")).resolves.toBeNull();
	});

	it("propagates a throw — there is no Postgres copy to fall back to", async () => {
		client.getdel.mockRejectedValue(new Error("upstash down"));

		await expect(storage().getAndDelete("verification:x")).rejects.toThrow(
			"getAndDelete failed",
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

	// The one input where a truthiness check diverges from intent: 0 is an expired
	// session, and writing it without `ex` leaves a key that never expires.
	it("skips the write entirely when the TTL has already run out", async () => {
		await storage().set("token", "value", 0);

		expect(client.set).not.toHaveBeenCalled();
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
		).rejects.toThrow("set failed");
	});
});

describe("delete", () => {
	// Swallowing this lets Better Auth drop the Postgres row while the Redis key
	// survives to authenticate for the rest of its TTL. See adr007.
	it("propagates a throw rather than failing open", async () => {
		client.del.mockRejectedValue(new Error("upstash down"));

		await expect(storage().delete("token")).rejects.toThrow("delete failed");
	});
});

describe("increment", () => {
	// Two round trips would leave the counter with no TTL if EXPIRE failed after INCR,
	// permanently 429-ing that IP. `NX` also stops a later call sliding the window.
	it("issues INCR and EXPIRE NX as one pipelined round trip", async () => {
		pipeline.exec.mockResolvedValue([7, 0]);

		await expect(storage().increment("ip", 60)).resolves.toBe(7);
		expect(pipeline.incr).toHaveBeenCalledWith("ba:test:ip");
		expect(pipeline.expire).toHaveBeenCalledWith("ba:test:ip", 60, "NX");
		expect(pipeline.exec).toHaveBeenCalledTimes(1);
	});

	// 0 reads as under the limit. A throw would 500 every /api/auth/* request.
	it("returns 0 when the pipeline throws", async () => {
		pipeline.exec.mockRejectedValue(new Error("upstash down"));

		await expect(storage().increment("ip", 60)).resolves.toBe(0);
	});
});

describe("failure redaction", () => {
	// Built by the installed client, not by hand: `${body.error}, command was:
	// ${JSON.stringify(req.body)}` carries the raw session token and the user record.
	const upstashError = () =>
		new errors.UpstashError(
			'ERR max daily request limit exceeded, command was: [["set","ba:test:sess_tok_SECRET","{\\"user\\":{\\"email\\":\\"victim@example.com\\"}}","ex",604800]]',
		);

	it("logs the reason without the command body Upstash appends", async () => {
		client.get.mockRejectedValue(upstashError());

		await storage().get("sess_tok_SECRET");

		expect(loggedOutput()).toContain("max daily request limit exceeded");
		expect(loggedOutput()).not.toContain("sess_tok_SECRET");
		expect(loggedOutput()).not.toContain("victim@example.com");
	});

	// UpstashJSONParseError quotes 200 chars of the response body, and on a successful
	// GET that body is the stored session. Nothing in the message is safe to print.
	it("logs nothing but the name for a response-body parse failure", async () => {
		client.get.mockRejectedValue(
			new errors.UpstashJSONParseError(
				'{"result":"{\\"session\\":{\\"token\\":\\"sess_tok_SECRET\\"}}"}',
			),
		);

		await storage().get("sess_tok_SECRET");

		expect(loggedOutput()).toContain("UpstashJSONParseError");
		expect(loggedOutput()).not.toContain("sess_tok_SECRET");
	});

	// Better Auth logs whatever we throw as a whole error object, straight to the
	// console — so the rethrown error has to be redacted too, not just the log.
	it("rethrows a redacted error, never the client's own", async () => {
		client.del.mockRejectedValue(upstashError());

		await expect(storage().delete("sess_tok_SECRET")).rejects.toThrow(
			expect.objectContaining({
				name: "RedisUnavailableError",
				message: expect.not.stringContaining("sess_tok_SECRET"),
			}),
		);
	});

	it("rethrows a redacted error on the manifest paths too", async () => {
		client.get.mockRejectedValue(upstashError());

		await expect(storage().get("active-sessions-usr_42")).rejects.toThrow(
			expect.objectContaining({
				message: expect.not.stringContaining("victim@example.com"),
			}),
		);
	});
});

describe("prerender interrupt", () => {
	// Built by Next, not by hand: a runtime prefetch hangs every uncached fetch()
	// and rejects it with this once the prerender ends.
	const prerenderEnded = async () => {
		const prerender = new AbortController();
		const fetchCall = makeUntrackedHangingPromise(
			prerender.signal,
			"/receipts",
			"fetch()",
		);
		prerender.abort();
		return fetchCall.catch((error: unknown) => error);
	};

	it("logs nothing, and still presents as a miss", async () => {
		client.get.mockRejectedValue(await prerenderEnded());

		await expect(storage().get("token")).resolves.toBeNull();
		expect(loggedOutput()).toBe("");
	});
});

// The prefix isolates environments and databases from each other. A method that
// skips it reads a neighbouring deployment's sessions.
describe("prefixing", () => {
	it("applies the injected prefix to every method", async () => {
		const store = createSecondaryStorage({
			url: "https://kv",
			token: "t",
			prefix: "ba:preview:deadbeef:",
		});

		await store.get("k");
		await store.getAndDelete("k");
		await store.set("k", "v");
		await store.delete("k");
		await store.increment("k", 60);

		const keyed = [
			client.get,
			client.getdel,
			client.set,
			client.del,
			pipeline.incr,
			pipeline.expire,
		];
		for (const fn of keyed) {
			expect(fn.mock.calls[0]?.[0]).toBe("ba:preview:deadbeef:k");
		}
	});
});
