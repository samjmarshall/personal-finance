import { beforeEach, describe, expect, it, vi } from "vitest";

import { type RecordedQuery, recordingDb } from "~/server/db/recording-db.fake";

// The route gates on the session, looks up the blob pathname and streams the blob
// back with inert headers. Auth, the db and Blob are stubbed so this stays a unit
// over that job.
const { getSession } = vi.hoisted(() => ({
	getSession: vi.fn<() => Promise<{ user: { id: string } } | null>>(),
}));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession } } }));

// `vi.mock` hoists above module-level consts, so the db lives in a hoisted holder
// the tests reset. Every test sets `row` to the pathname the select should find.
const store = vi.hoisted(() => ({
	row: undefined as string | undefined,
	db: undefined as unknown,
	queries: [] as RecordedQuery[],
}));
vi.mock("~/server/db", () => ({
	get db() {
		return store.db;
	},
}));

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get }));

const { GET } = await import("./route");

const request = () => new Request("https://ledger.test/api/receipts/3/image");
const call = (id: string) =>
	GET(request(), { params: Promise.resolve({ id }) });

const BYTES = new Uint8Array([137, 80, 78, 71]);
const blobStream = () =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(BYTES);
			controller.close();
		},
	});

beforeEach(() => {
	vi.clearAllMocks();
	getSession.mockResolvedValue({ user: { id: "member-1" } });
	store.row = "receipts/r.png";
	const { db, queries } = recordingDb((query) =>
		store.row === undefined
			? []
			: query.sql.startsWith("select")
				? [[store.row]]
				: [],
	);
	store.db = db;
	store.queries = queries;
	get.mockResolvedValue({
		statusCode: 200,
		stream: blobStream(),
		blob: { contentType: "image/png" },
	});
});

describe("GET /api/receipts/[id]/image", () => {
	it("401s a signed-out request without touching the db", async () => {
		getSession.mockResolvedValue(null);

		const response = await call("3");

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Unauthorized");
		expect(store.queries).toEqual([]);
		expect(get).not.toHaveBeenCalled();
	});

	it("404s a non-numeric id without touching the db", async () => {
		const response = await call("abc");

		expect(response.status).toBe(404);
		expect(store.queries).toEqual([]);
		expect(get).not.toHaveBeenCalled();
	});

	it("404s a missing row, after selecting its pathname by id", async () => {
		store.row = undefined;

		const response = await call("3");

		expect(response.status).toBe(404);
		expect(store.queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "blobPathname" from "receipt" where "receipt"."id" = $1",
			]
		`);
		expect(store.queries[0]?.params).toEqual([3]);
		expect(get).not.toHaveBeenCalled();
	});

	it.each([
		["null", null],
		["a 404", { statusCode: 404 }],
	])("404s when Blob answers %s", async (_, answer) => {
		get.mockResolvedValue(answer);

		const response = await call("3");

		expect(response.status).toBe(404);
	});

	it("streams the private blob under its type with inert, uncacheable headers", async () => {
		const response = await call("3");

		expect(response.status).toBe(200);
		expect(get).toHaveBeenCalledWith("receipts/r.png", { access: "private" });
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("downgrades a type outside the renderable list to octet-stream", async () => {
		get.mockResolvedValue({
			statusCode: 200,
			stream: blobStream(),
			blob: { contentType: "text/html" },
		});

		const response = await call("3");

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"application/octet-stream",
		);
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
});
