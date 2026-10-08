import { del, get, put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VercelBlobStore } from "./blob-store";

vi.mock("@vercel/blob", () => ({ del: vi.fn(), get: vi.fn(), put: vi.fn() }));

const delMock = vi.mocked(del);
const getMock = vi.mocked(get);
const putMock = vi.mocked(put);

beforeEach(() => vi.clearAllMocks());

describe("VercelBlobStore.read", () => {
	it("reads privately by pathname and returns the bytes with the stored content type", async () => {
		getMock.mockResolvedValue({
			statusCode: 200,
			stream: new Blob([new Uint8Array([1, 2, 3])]).stream(),
			blob: { contentType: "image/png" },
		} as never);

		const result = await new VercelBlobStore().read("receipts/r1.png");

		expect(getMock).toHaveBeenCalledWith("receipts/r1.png", {
			access: "private",
		});
		expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
		expect(result.mediaType).toBe("image/png");
	});

	it.each([[null], [{ statusCode: 404 }]])(
		"throws when the store answers %j",
		async (answer) => {
			getMock.mockResolvedValue(answer as never);

			await expect(
				new VercelBlobStore().read("receipts/missing.png"),
			).rejects.toThrow("blob fetch failed for receipts/missing.png");
		},
	);
});

describe("VercelBlobStore.write", () => {
	// addRandomSuffix would rewrite the key we generated, so the pathname stored on
	// the row would no longer resolve for either read sink.
	it("puts privately, keyed exactly by the pathname given, and returns the store's location", async () => {
		putMock.mockResolvedValue({
			url: "https://blob.test/receipts/email/x.html",
			pathname: "receipts/email/x.html",
		} as never);

		const result = await new VercelBlobStore().write(
			"receipts/email/x.html",
			"<p>x</p>",
			"text/html",
		);

		expect(putMock).toHaveBeenCalledWith("receipts/email/x.html", "<p>x</p>", {
			access: "private",
			contentType: "text/html",
			addRandomSuffix: false,
		});
		expect(result).toEqual({
			url: "https://blob.test/receipts/email/x.html",
			pathname: "receipts/email/x.html",
		});
	});

	it("wraps bytes as a Buffer (the SDK's PutBody has no Uint8Array arm)", async () => {
		putMock.mockResolvedValue({ url: "u", pathname: "p" } as never);

		await new VercelBlobStore().write(
			"p",
			new Uint8Array([1, 2, 3]),
			"application/pdf",
		);

		const [, body] = putMock.mock.calls[0] ?? [];
		expect(Buffer.isBuffer(body)).toBe(true);
		expect(Array.from(body as Buffer)).toEqual([1, 2, 3]);
	});
});

describe("VercelBlobStore.delete", () => {
	it("deletes by pathname", async () => {
		delMock.mockResolvedValue(undefined);

		await new VercelBlobStore().delete("receipts/r1.png");

		expect(delMock).toHaveBeenCalledWith("receipts/r1.png");
	});

	it("lets a store refusal propagate", async () => {
		const refusal = new Error("store down");
		delMock.mockRejectedValue(refusal);

		await expect(new VercelBlobStore().delete("receipts/r1.png")).rejects.toBe(
			refusal,
		);
	});
});
