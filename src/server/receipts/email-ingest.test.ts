import { describe, expect, it, vi } from "vitest";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import {
	emailBlobPathname,
	type InboundEmailEvent,
	isReceiptAttachment,
	MAX_EMAIL_ATTACHMENTS,
	makeRunIngestInboundEmail,
	parseFromAddress,
} from "./email-ingest";

const SENDER_USER_ID = "user-1";

describe("parseFromAddress", () => {
	// The stored allowlist is lower-cased and bare, so the parsed sender has to land
	// in exactly that shape or every lookup misses and every mail is dropped.
	it.each([
		["Sam <A@B.com>", "a@b.com"],
		["a@b.com", "a@b.com"],
		["  A@B.com  ", "a@b.com"],
		["<A@B.com>", "a@b.com"],
		['"Marshall, Sam" <Sam.M@Example.COM>', "sam.m@example.com"],
		["Sam < a@b.com >", "a@b.com"],
		// A quoted display name may legally contain angle brackets. Taking the first
		// pair lets a sender put an allowlisted address in their display name and have
		// their receipts filed to that member — the real addr-spec is the last pair.
		['"<victim@allowed.com>" <attacker@evil.com>', "attacker@evil.com"],
	])("parses %j to %j", (from, expected) => {
		expect(parseFromAddress(from)).toBe(expected);
	});
});

describe("isReceiptAttachment", () => {
	it.each([
		["image/jpeg", undefined, undefined, true],
		["image/png", undefined, undefined, true],
		["application/pdf", "attachment", undefined, true],
		// An inline part is the sender's signature image or a vendor logo. Without
		// this filter every branded e-receipt mints a junk Receipt per logo.
		["image/png", "inline", undefined, false],
		["image/png", undefined, "img001", false],
		["text/calendar", "attachment", undefined, false],
		["text/html", "attachment", undefined, false],
		[null, "attachment", undefined, false],
	])(
		"%j disposition=%j cid=%j → %j",
		(contentType, disposition, contentId, expected) => {
			expect(
				isReceiptAttachment({
					id: "a1",
					content_type: contentType,
					content_disposition: disposition,
					content_id: contentId,
				}),
			).toBe(expected);
		},
	);
});

describe("emailBlobPathname", () => {
	it.each([
		["image/jpeg", /^receipts\/email\/[0-9a-f-]{36}\.jpg$/],
		["image/png", /^receipts\/email\/[0-9a-f-]{36}\.png$/],
		["application/pdf", /^receipts\/email\/[0-9a-f-]{36}\.pdf$/],
		["text/html", /^receipts\/email\/[0-9a-f-]{36}\.html$/],
		["text/plain", /^receipts\/email\/[0-9a-f-]{36}\.txt$/],
	])("maps %j under the email prefix", (contentType, pattern) => {
		expect(emailBlobPathname(contentType)).toMatch(pattern);
	});

	it("gives every call a fresh key so two attachments never collide", () => {
		expect(emailBlobPathname("image/png")).not.toBe(
			emailBlobPathname("image/png"),
		);
	});
});

// Every I/O dependency is injected, so the core runs with no network and no DB.
function harness({
	allowlist = [{ userId: SENDER_USER_ID }],
	attachments = [] as { id: string; download_url: string }[],
	email = { html: null as string | null, text: null as string | null },
} = {}) {
	// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
	let insertedRows: any[] = [];
	let events: OutboxEventDescriptor[] = [];

	const db = {
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => allowlist }),
			}),
		}),
	};

	const tx = {
		insert: () => ({
			// biome-ignore lint/suspicious/noExplicitAny: hand-rolled tx stands in for drizzle.
			values: (rows: any[]) => {
				insertedRows = rows;
				return {
					returning: async () => rows.map((_, i) => ({ id: i + 1 })),
				};
			},
		}),
	};

	const commitWithOutbox = vi.fn(
		// biome-ignore lint/suspicious/noExplicitAny: mirrors the generic write door.
		async (writes: any, buildEvents: any) => {
			const result = await writes(tx);
			events = buildEvents(result);
			return result;
		},
	);

	const put = vi.fn(async (pathname: string) => ({
		url: `https://blob.test/${pathname}`,
		pathname,
	}));
	const getEmail = vi.fn(async () => email);
	const listAttachments = vi.fn(async () => attachments);
	const fetchBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));

	const run = makeRunIngestInboundEmail({
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
		db: db as any,
		// biome-ignore lint/suspicious/noExplicitAny: mirrors the generic write door.
		commitWithOutbox: commitWithOutbox as any,
		// biome-ignore lint/suspicious/noExplicitAny: narrow stand-in for @vercel/blob.
		put: put as any,
		// biome-ignore lint/suspicious/noExplicitAny: narrow stand-in for the Resend client.
		getEmail: getEmail as any,
		// biome-ignore lint/suspicious/noExplicitAny: narrow stand-in for the Resend client.
		listAttachments: listAttachments as any,
		fetchBytes,
	});

	return {
		run,
		put,
		getEmail,
		listAttachments,
		fetchBytes,
		commitWithOutbox,
		rows: () => insertedRows,
		events: () => events,
	};
}

function event(overrides: Partial<InboundEmailEvent["data"]> = {}) {
	return {
		type: "email.received",
		data: {
			email_id: "email-1",
			from: "Sam <sam@example.com>",
			attachments: [],
			...overrides,
		},
	} as InboundEmailEvent;
}

describe("runIngestInboundEmail", () => {
	// Design decision 8: an unknown sender is dropped, not quarantined — and dropped
	// before anything that costs money or leaves a trace.
	it("drops mail from an address that is not on the allowlist", async () => {
		const h = harness({ allowlist: [] });

		await expect(h.run(event())).resolves.toEqual({ status: "dropped" });
	});

	it("touches no fetch, blob or write door for an unknown sender", async () => {
		const h = harness({ allowlist: [] });

		await h.run(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "application/pdf",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(h.listAttachments).not.toHaveBeenCalled();
		expect(h.getEmail).not.toHaveBeenCalled();
		expect(h.fetchBytes).not.toHaveBeenCalled();
		expect(h.put).not.toHaveBeenCalled();
		expect(h.commitWithOutbox).not.toHaveBeenCalled();
	});

	it("stores one qualifying attachment as a pending email Receipt", async () => {
		const h = harness({
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		const result = await h.run(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "application/pdf",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(result).toEqual({ status: "ingested", receiptIds: [1] });
		expect(h.rows()).toEqual([
			{
				userId: SENDER_USER_ID,
				status: ReceiptStatus.Pending,
				channel: ReceiptChannel.Email,
				blobUrl: expect.stringContaining("receipts/email/"),
				blobPathname: expect.stringMatching(
					/^receipts\/email\/[0-9a-f-]{36}\.pdf$/,
				),
				contentType: "application/pdf",
			},
		]);
	});

	// The frozen payload carries only a receiptId, so the row must exist before the
	// event fires — which is what makes the event a function of the write's result.
	it("mints exactly one receipt/email.received per stored row", async () => {
		const h = harness({
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		await h.run(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "image/jpeg",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(h.events()).toEqual([
			expect.objectContaining({
				name: "receipt/email.received",
				data: { receiptId: 1 },
			}),
		]);
	});

	it("attributes the receipt to the allowlist owner, not the sender header", async () => {
		const h = harness({
			allowlist: [{ userId: "someone-else" }],
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		await h.run(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "image/png",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(h.rows()[0]).toMatchObject({ userId: "someone-else" });
	});

	it("stores two qualifying attachments as two rows and two events", async () => {
		const h = harness({
			attachments: [
				{ id: "a1", download_url: "https://dl.test/a1" },
				{ id: "a2", download_url: "https://dl.test/a2" },
			],
		});

		const result = await h.run(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "application/pdf",
						content_disposition: "attachment",
					},
					{
						id: "a2",
						content_type: "image/png",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(result).toEqual({ status: "ingested", receiptIds: [1, 2] });
		expect(h.rows()).toHaveLength(2);
		expect(h.events().map((e) => e.data)).toEqual([
			{ receiptId: 1 },
			{ receiptId: 2 },
		]);
	});

	// Each stored attachment costs a blob write, a row and a Claude Vision call, all
	// triggered by an inbound email. Bound what one message can spend.
	it("stores at most MAX_EMAIL_ATTACHMENTS attachments from one email", async () => {
		const many = Array.from({ length: 25 }, (_, i) => ({
			id: `a${i}`,
			download_url: `https://dl.test/a${i}`,
		}));
		const h = harness({ attachments: many });

		const result = await h.run(
			event({
				attachments: many.map((a) => ({
					id: a.id,
					content_type: "application/pdf",
					content_disposition: "attachment",
				})),
			}),
		);

		expect(h.rows()).toHaveLength(MAX_EMAIL_ATTACHMENTS);
		expect(h.fetchBytes).toHaveBeenCalledTimes(MAX_EMAIL_ATTACHMENTS);
		expect(result).toMatchObject({ status: "ingested" });
	});

	// A branded e-receipt is a logo plus the receipt itself in the body. Treating the
	// logo as the receipt would blob a 2kb image and hand the worker nothing to read.
	it("falls back to the body when the only attachment is an inline logo", async () => {
		const h = harness({ email: { html: "<p>Total $9</p>", text: null } });

		await h.run(
			event({
				attachments: [
					{
						id: "logo",
						content_type: "image/png",
						content_disposition: "inline",
						content_id: "img001",
					},
				],
			}),
		);

		expect(h.listAttachments).not.toHaveBeenCalled();
		expect(h.rows()[0]).toMatchObject({ contentType: "text/html" });
	});

	it("stores the html body when there are no attachments at all", async () => {
		const h = harness({ email: { html: "<p>Total $9</p>", text: "Total $9" } });

		const result = await h.run(event());

		expect(result).toEqual({ status: "ingested", receiptIds: [1] });
		expect(h.put).toHaveBeenCalledWith(
			expect.stringMatching(/\.html$/),
			"<p>Total $9</p>",
			expect.objectContaining({ contentType: "text/html" }),
		);
	});

	// html carries the line-item table; text is the flattened fallback the sender's
	// mail client generated, so it loses structure the extractor wants.
	it("prefers html over text", async () => {
		const h = harness({ email: { html: "<p>rich</p>", text: "plain" } });

		await h.run(event());

		expect(h.rows()[0]).toMatchObject({ contentType: "text/html" });
	});

	it("stores the text body when html is absent", async () => {
		const h = harness({ email: { html: null, text: "Total $9" } });

		await h.run(event());

		expect(h.rows()[0]).toMatchObject({ contentType: "text/plain" });
	});

	it("writes nothing when both bodies are blank", async () => {
		const h = harness({ email: { html: "   ", text: "" } });

		const result = await h.run(event());

		expect(result).toEqual({ status: "empty" });
		expect(h.put).not.toHaveBeenCalled();
		expect(h.commitWithOutbox).not.toHaveBeenCalled();
	});

	// The blob is written before the transaction, so the pathname the row records has
	// to be the one the store actually accepted — the read sinks resolve by pathname.
	it("records the pathname the blob store returned", async () => {
		const h = harness({ email: { html: "<p>x</p>", text: null } });

		await h.run(event());

		const [pathname] = h.put.mock.calls[0] ?? [];
		expect(h.rows()[0]).toMatchObject({
			blobPathname: pathname,
			blobUrl: `https://blob.test/${pathname}`,
		});
	});

	// addRandomSuffix would rewrite the key we generated, so the pathname stored on
	// the row would no longer resolve.
	it("puts privately without a random suffix", async () => {
		const h = harness({ email: { html: "<p>x</p>", text: null } });

		await h.run(event());

		expect(h.put).toHaveBeenCalledWith(
			expect.any(String),
			expect.anything(),
			expect.objectContaining({ access: "private", addRandomSuffix: false }),
		);
	});
});
