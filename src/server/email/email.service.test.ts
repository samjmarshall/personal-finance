import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboundEmailEvent } from "./email.dto";
import type { AttachmentDownload, EmailBody } from "./email.mailbox";
import type { EmailRepository, StoredBlob } from "./email.repository";
import {
	EmailService,
	emailBlobPathname,
	isReceiptAttachment,
	MAX_EMAIL_ATTACHMENTS,
	parseFromAddress,
} from "./email.service";

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

// Every port is a plain object literal against its interface, so the service runs
// with no network and no DB. The repository records what it was asked to mint.
function harness({
	allowlist = [{ userId: SENDER_USER_ID }],
	attachments = [],
	email = { html: null, text: null },
}: {
	allowlist?: { userId: string }[];
	attachments?: AttachmentDownload[];
	email?: EmailBody;
} = {}) {
	const created: { userId: string; blobs: StoredBlob[] }[] = [];

	const repository: EmailRepository = {
		findAllowedSender: async () => allowlist[0],
		createPendingReceipts: async (userId, blobs) => {
			created.push({ userId, blobs });
			return blobs.map((_, i) => i + 1);
		},
	};
	const mailbox = {
		getBody: vi.fn(async () => email),
		listAttachments: vi.fn(async () => attachments),
		download: vi.fn(async () => new Uint8Array([1, 2, 3])),
	};
	const blobStore = {
		read: vi.fn(async () => {
			throw new Error("unused");
		}),
		write: vi.fn(async (pathname: string) => ({
			url: `https://blob.test/${pathname}`,
			pathname,
		})),
	};

	return {
		service: new EmailService({ repository, mailbox, blobStore }),
		mailbox,
		blobStore,
		created,
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

const pdf = (id: string) => ({
	id,
	content_type: "application/pdf",
	content_disposition: "attachment",
});

afterEach(() => vi.restoreAllMocks());

describe("EmailService.ingest", () => {
	// Design decision 8: an unknown sender is dropped, not quarantined — and dropped
	// before anything that costs money or leaves a trace.
	it("drops mail from an address that is not on the allowlist", async () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const h = harness({ allowlist: [] });

		await expect(h.service.ingest(event())).resolves.toEqual({
			status: "dropped",
		});
	});

	it("touches no fetch, blob or write door for an unknown sender", async () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const h = harness({ allowlist: [] });

		await h.service.ingest(event({ attachments: [pdf("a1")] }));

		expect(h.mailbox.listAttachments).not.toHaveBeenCalled();
		expect(h.mailbox.getBody).not.toHaveBeenCalled();
		expect(h.mailbox.download).not.toHaveBeenCalled();
		expect(h.blobStore.write).not.toHaveBeenCalled();
		expect(h.created).toEqual([]);
	});

	it("stores one qualifying attachment and mints it for the allowlist owner", async () => {
		const h = harness({
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		const result = await h.service.ingest(event({ attachments: [pdf("a1")] }));

		expect(result).toEqual({ status: "ingested", receiptIds: [1] });
		expect(h.mailbox.download).toHaveBeenCalledWith("https://dl.test/a1");
		expect(h.created).toEqual([
			{
				userId: SENDER_USER_ID,
				blobs: [
					{
						blobUrl: expect.stringContaining("receipts/email/"),
						blobPathname: expect.stringMatching(
							/^receipts\/email\/[0-9a-f-]{36}\.pdf$/,
						),
						contentType: "application/pdf",
					},
				],
			},
		]);
	});

	it("attributes the receipt to the allowlist owner, not the sender header", async () => {
		const h = harness({
			allowlist: [{ userId: "someone-else" }],
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		await h.service.ingest(event({ attachments: [pdf("a1")] }));

		expect(h.created[0]?.userId).toBe("someone-else");
	});

	it("stores two qualifying attachments as two blobs in one mint", async () => {
		const h = harness({
			attachments: [
				{ id: "a1", download_url: "https://dl.test/a1" },
				{ id: "a2", download_url: "https://dl.test/a2" },
			],
		});

		const result = await h.service.ingest(
			event({
				attachments: [
					pdf("a1"),
					{
						id: "a2",
						content_type: "image/png",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(result).toEqual({ status: "ingested", receiptIds: [1, 2] });
		expect(h.created).toHaveLength(1);
		expect(h.created[0]?.blobs.map((b) => b.contentType)).toEqual([
			"application/pdf",
			"image/png",
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

		const result = await h.service.ingest(
			event({ attachments: many.map((a) => pdf(a.id)) }),
		);

		expect(h.created[0]?.blobs).toHaveLength(MAX_EMAIL_ATTACHMENTS);
		expect(h.mailbox.download).toHaveBeenCalledTimes(MAX_EMAIL_ATTACHMENTS);
		expect(result).toMatchObject({ status: "ingested" });
	});

	// Resend listed attachments the metadata promised and none came back. Not worth
	// a 5xx retry storm — the mail is still in Resend if it matters.
	it("answers empty, with a warning, when no listed download matches the metadata", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const h = harness({ attachments: [] });

		const result = await h.service.ingest(event({ attachments: [pdf("a1")] }));

		expect(result).toEqual({ status: "empty" });
		expect(h.mailbox.getBody).not.toHaveBeenCalled();
		expect(h.created).toEqual([]);
		expect(console.warn).toHaveBeenCalled();
	});

	// A branded e-receipt is a logo plus the receipt itself in the body. Treating the
	// logo as the receipt would blob a 2kb image and hand the worker nothing to read.
	it("falls back to the body when the only attachment is an inline logo", async () => {
		const h = harness({ email: { html: "<p>Total $9</p>", text: null } });

		await h.service.ingest(
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

		expect(h.mailbox.listAttachments).not.toHaveBeenCalled();
		expect(h.created[0]?.blobs[0]).toMatchObject({ contentType: "text/html" });
	});

	it("stores the html body when there are no attachments at all", async () => {
		const h = harness({ email: { html: "<p>Total $9</p>", text: "Total $9" } });

		const result = await h.service.ingest(event());

		expect(result).toEqual({ status: "ingested", receiptIds: [1] });
		expect(h.blobStore.write).toHaveBeenCalledWith(
			expect.stringMatching(/\.html$/),
			"<p>Total $9</p>",
			"text/html",
		);
	});

	// html carries the line-item table; text is the flattened fallback the sender's
	// mail client generated, so it loses structure the extractor wants.
	it("prefers html over text", async () => {
		const h = harness({ email: { html: "<p>rich</p>", text: "plain" } });

		await h.service.ingest(event());

		expect(h.created[0]?.blobs[0]).toMatchObject({ contentType: "text/html" });
	});

	it("stores the text body when html is absent", async () => {
		const h = harness({ email: { html: null, text: "Total $9" } });

		await h.service.ingest(event());

		expect(h.created[0]?.blobs[0]).toMatchObject({
			contentType: "text/plain",
		});
	});

	it("writes nothing when both bodies are blank", async () => {
		const h = harness({ email: { html: "   ", text: "" } });

		const result = await h.service.ingest(event());

		expect(result).toEqual({ status: "empty" });
		expect(h.blobStore.write).not.toHaveBeenCalled();
		expect(h.created).toEqual([]);
	});

	// The blob is written before the transaction, so the pathname the row records has
	// to be the one the store actually accepted — the read sinks resolve by pathname.
	it("records the pathname the blob store returned", async () => {
		const h = harness({ email: { html: "<p>x</p>", text: null } });

		await h.service.ingest(event());

		const [pathname] = h.blobStore.write.mock.calls[0] ?? [];
		expect(h.created[0]?.blobs[0]).toMatchObject({
			blobPathname: pathname,
			blobUrl: `https://blob.test/${pathname}`,
		});
	});
});
