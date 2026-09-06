import { describe, expect, it } from "vitest";

import { isHeic, prepReceipt } from "./prep-receipt";

// Content is irrelevant to isHeic — it gates on name + reported MIME only.
function file(name: string, type: string): File {
	return new File([new Uint8Array()], name, { type });
}

describe("isHeic", () => {
	it("matches the HEIC/HEIF MIME types", () => {
		expect(isHeic(file("x.heic", "image/heic"))).toBe(true);
		expect(isHeic(file("x.heif", "image/heif"))).toBe(true);
	});

	it("falls back to the extension when the browser reports no type", () => {
		// Desktop Chrome can't decode HEIC and hands back an empty File.type.
		expect(isHeic(file("IMG_0001.HEIC", ""))).toBe(true);
		expect(isHeic(file("photo.heif", ""))).toBe(true);
	});

	it("is false for non-HEIC files and empty-type non-HEIC names", () => {
		expect(isHeic(file("x.jpg", "image/jpeg"))).toBe(false);
		expect(isHeic(file("x.png", "image/png"))).toBe(false);
		expect(isHeic(file("scan.pdf", "application/pdf"))).toBe(false);
		expect(isHeic(file("noext", ""))).toBe(false);
		expect(isHeic(file("x.jpg", ""))).toBe(false);
	});
});

describe("prepReceipt", () => {
	it("stamps application/pdf on a PDF the browser reported with no type", async () => {
		// Windows/Linux browsers hand back an empty File.type for local PDFs; every
		// downstream branch (upload allowlist, worker file part, detail view) keys on it.
		const out = await prepReceipt(file("scan.pdf", ""));
		expect(out.type).toBe("application/pdf");
		expect(out.name).toBe("scan.pdf");
	});

	it("passes a correctly typed PDF through untouched", async () => {
		const pdf = file("scan.pdf", "application/pdf");
		expect(await prepReceipt(pdf)).toBe(pdf);
	});
});
