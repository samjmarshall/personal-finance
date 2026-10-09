import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboundEmailEvent } from "~/domain/email";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import type { StoredBlob } from "~/server/receipts/receipts.service";
import type { AttachmentDownload, EmailBody } from "./email.mailbox";
import {
	EmailService,
	emailBlobPathname,
	isReceiptAttachment,
	MAX_EMAIL_ATTACHMENTS,
	parseFromAddress,
} from "./email.service";

const SENDER_USER_ID = "user-1";

type LogEntry = { level: string; msg: string; attrs: LogAttributes };

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
		// A sender can plant an allowlisted address in their name, a comment or a
		// second mailbox. Two different addresses means no sender to trust.
		['"<victim@allowed.com>" <attacker@evil.com>', ""],
		["Attacker <attacker@evil.com> (<victim@allowed.com>)", ""],
		["<attacker@evil.com>, <victim@allowed.com>", ""],
		["attacker@evil.com, victim@allowed.com", ""],
		["<a@b.com> <victim@allowed.com>", ""],
		// The real address can hide from the pattern behind quotes, a comment or a
		// space, leaving the planted one as the only address seen.
		['"victim@allowed.com"@evil.com', ""],
		['victim@allowed.com <"a b"@evil.com>', ""],
		["victim@allowed.com <x(c)@evil.com>", ""],
		["victim@allowed.com <x @evil.com>", ""],
		// Decoded, the quotes may be the sender's own text and hide nothing.
		['" <attacker@evil.com> ("<victim@allowed.com>)', ""],
		// A decoded name can be unquoted and hold commas, quotes, brackets or the
		// address itself; it is still one sender.
		["Doe, John <J@X.com>", "j@x.com"],
		["a@b.com (Sam)", "a@b.com"],
		["sam@x.com <Sam@X.com>", "sam@x.com"],
		['O"Brien <sam@x.com>', "sam@x.com"],
		["Sam :( <sam@x.com>", "sam@x.com"],
		["Sam <3 <sam@x.com>", "sam@x.com"],
		// Outlook and some forwarders wrap the repeated address.
		["'sam@x.com' <sam@x.com>", "sam@x.com"],
		["Sam [sam@x.com] <sam@x.com>", "sam@x.com"],
		["sam@x.com <mailto:sam@x.com>", "sam@x.com"],
		["Sam (sam@x.com.) <sam@x.com>", "sam@x.com"],
		["'victim@allowed.com' <attacker@evil.com>", ""],
		["", ""],
		["Sam", ""],
		[`${"a".repeat(990)} <a@b.com>`, ""],
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
		// Mail clients add params and mixed case; the header still names a receipt type.
		["image/JPEG; name=a.jpg", "attachment", undefined, true],
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
	const looked: string[] = [];

	const allowedSenders = {
		memberFor: async (email: string) => {
			looked.push(email);
			return allowlist[0]?.userId;
		},
	};
	const receipts = {
		createFromEmail: async (userId: string, blobs: StoredBlob[]) => {
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

	// Child-logger factory returns the same instance — the service never re-binds;
	// only the route module does that once on startup.
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};

	return {
		service: new EmailService({
			allowedSenders,
			receipts,
			mailbox,
			blobStore,
			logger,
		}),
		mailbox,
		blobStore,
		created,
		looked,
		logs,
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
		const h = harness({ allowlist: [] });

		await expect(h.service.ingest(event())).resolves.toEqual({
			status: "dropped",
		});
	});

	// The full from is a Member identifier; only the domain may reach the logs.
	it("logs the drop by domain, never the sender's address", async () => {
		const h = harness({ allowlist: [] });

		await h.service.ingest(event());

		const drop = h.logs.find(
			(l) => l.msg === "inbound email dropped: unknown sender",
		);
		expect(drop?.level).toBe("info");
		expect(drop?.attrs["email.from_domain"]).toBe("example.com");
		expect(JSON.stringify(drop?.attrs)).not.toContain("sam@example.com");
	});

	it("looks up the bare, lower-cased sender address", async () => {
		const h = harness({ allowlist: [] });

		await h.service.ingest(
			event({ from: "Sam@Example.com <Sam@Example.com>" }),
		);

		expect(h.looked).toEqual(["sam@example.com"]);
	});

	it("drops a header with no single address before any lookup", async () => {
		const h = harness();

		const result = await h.service.ingest(
			event({ from: '"<sam@example.com>" <a@example.com>' }),
		);

		expect(result).toEqual({ status: "dropped" });
		expect(h.looked).toEqual([]);
		expect(h.logs.map((l) => l.msg)).toEqual([
			"inbound email dropped: unreadable sender",
		]);
	});

	it("touches no fetch, blob or write door for an unknown sender", async () => {
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

	// A raw header would mint a `.bin` key and the proxy would serve it as octet-stream.
	it("stores the bare media type, not the raw header", async () => {
		const h = harness({
			attachments: [{ id: "a1", download_url: "https://dl.test/a1" }],
		});

		await h.service.ingest(
			event({
				attachments: [
					{
						id: "a1",
						content_type: "image/JPEG; name=a.jpg",
						content_disposition: "attachment",
					},
				],
			}),
		);

		expect(h.created[0]?.blobs[0]).toMatchObject({ contentType: "image/jpeg" });
		expect(h.created[0]?.blobs[0]?.blobPathname).toMatch(/\.jpg$/);
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
		const h = harness({ attachments: [] });

		const result = await h.service.ingest(event({ attachments: [pdf("a1")] }));

		expect(result).toEqual({ status: "empty" });
		expect(h.mailbox.getBody).not.toHaveBeenCalled();
		expect(h.created).toEqual([]);
		const warn = h.logs.find(
			(l) => l.msg === "inbound email attachments resolved to nothing",
		);
		expect(warn?.level).toBe("warn");
		expect(warn?.attrs["email.qualifying"]).toBe(1);
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

	it("logs the minted receipt ids on a successful ingest", async () => {
		const h = harness({ email: { html: "<p>Total $9</p>", text: null } });

		await h.service.ingest(event());

		const ingested = h.logs.find((l) => l.msg === "inbound email ingested");
		expect(ingested?.level).toBe("info");
		expect(ingested?.attrs["receipt.ids"]).toEqual([1]);
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
