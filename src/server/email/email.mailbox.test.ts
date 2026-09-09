import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES, ResendInboundMailbox } from "./email.mailbox";

function harness() {
	const get = vi.fn();
	const list = vi.fn();
	const resend = { emails: { receiving: { get, attachments: { list } } } };
	return {
		// biome-ignore lint/suspicious/noExplicitAny: narrow stand-in for the Resend client.
		mailbox: new ResendInboundMailbox({ resend: resend as any }),
		get,
		list,
	};
}

// A fetch reply with just the surface `download` reads. `arrayBuffer` is a spy so a
// test can prove the body was never pulled.
function reply(
	body: Uint8Array,
	opts: { ok?: boolean; status?: number; contentLength?: number } = {},
) {
	return {
		ok: opts.ok ?? true,
		status: opts.status ?? 200,
		headers: new Headers(
			opts.contentLength === undefined
				? {}
				: { "content-length": String(opts.contentLength) },
		),
		arrayBuffer: vi.fn(async () => body.slice().buffer),
	};
}

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ResendInboundMailbox.getBody", () => {
	it("returns the html and text bodies", async () => {
		const h = harness();
		h.get.mockResolvedValue({
			data: { html: "<p>x</p>", text: "x", subject: "ignored" },
			error: null,
		});

		await expect(h.mailbox.getBody("email-1")).resolves.toEqual({
			html: "<p>x</p>",
			text: "x",
		});
		expect(h.get).toHaveBeenCalledWith("email-1");
	});

	it("throws with Resend's message when the read fails", async () => {
		const h = harness();
		h.get.mockResolvedValue({ data: null, error: { message: "not_found" } });

		await expect(h.mailbox.getBody("email-1")).rejects.toThrow(
			"resend get email failed: not_found",
		);
	});
});

describe("ResendInboundMailbox.listAttachments", () => {
	it("lists by email id and unwraps the page", async () => {
		const h = harness();
		const items = [{ id: "a1", download_url: "https://dl.test/a1" }];
		h.list.mockResolvedValue({ data: { data: items }, error: null });

		await expect(h.mailbox.listAttachments("email-1")).resolves.toEqual(items);
		expect(h.list).toHaveBeenCalledWith({ emailId: "email-1" });
	});

	it("throws with Resend's message when the list fails", async () => {
		const h = harness();
		h.list.mockResolvedValue({ data: null, error: { message: "rate_limit" } });

		await expect(h.mailbox.listAttachments("email-1")).rejects.toThrow(
			"resend list attachments failed: rate_limit",
		);
	});
});

describe("ResendInboundMailbox.download", () => {
	it("returns the body bytes, under a timeout", async () => {
		const h = harness();
		fetchMock.mockResolvedValue(reply(new Uint8Array([1, 2, 3])));

		const bytes = await h.mailbox.download("https://dl.test/a1");

		expect(Array.from(bytes)).toEqual([1, 2, 3]);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://dl.test/a1",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("throws on a non-2xx without reading the body", async () => {
		const h = harness();
		const r = reply(new Uint8Array(0), { ok: false, status: 502 });
		fetchMock.mockResolvedValue(r);

		await expect(h.mailbox.download("https://dl.test/a1")).rejects.toThrow(
			"attachment download failed: 502",
		);
		expect(r.arrayBuffer).not.toHaveBeenCalled();
	});

	// The declared length is checked first so an oversize attachment is refused
	// before a byte is buffered.
	it("rejects a declared oversize before reading the body", async () => {
		const h = harness();
		const r = reply(new Uint8Array(0), {
			contentLength: MAX_ATTACHMENT_BYTES + 1,
		});
		fetchMock.mockResolvedValue(r);

		await expect(h.mailbox.download("https://dl.test/a1")).rejects.toThrow(
			"attachment too large",
		);
		expect(r.arrayBuffer).not.toHaveBeenCalled();
	});

	// content-length is only a claim, so the buffered length is the real bound.
	it("rejects an oversize body even when the header under-reports it", async () => {
		const h = harness();
		fetchMock.mockResolvedValue(
			reply(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), { contentLength: 10 }),
		);

		await expect(h.mailbox.download("https://dl.test/a1")).rejects.toThrow(
			"attachment too large",
		);
	});
});
