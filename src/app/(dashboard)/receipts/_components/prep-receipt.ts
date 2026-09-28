import type { Options } from "browser-image-compression";

import { receiptMediaKind } from "~/domain/receipts";

// Big phone photos → keep the upload small: a legible receipt well under the 10MB
// token cap. Claude also downscales >1568px, so extra pixels only cost bandwidth.
const COMPRESS: Options = {
	maxWidthOrHeight: 2048,
	maxSizeMB: 1,
	fileType: "image/jpeg",
	useWebWorker: true,
};

/**
 * Cheap sync gate deciding whether to load the heavy libheif WASM. `File.type` is
 * unreliable for HEIC — empty on desktop Chrome — so it also sniffs the extension.
 */
export function isHeic(file: File): boolean {
	return (
		file.type === "image/heic" ||
		file.type === "image/heif" ||
		(file.type === "" && /\.hei[cf]$/i.test(file.name))
	);
}

/**
 * Normalize a picked receipt to a compact JPEG before upload. PDFs pass through
 * (raster tools don't apply); HEIC is transcoded first (Claude Vision + browsers
 * can't read it), then every image is downscaled + compressed. Both libs load
 * dynamically so libheif WASM never ships to a non-HEIC upload.
 */
export async function prepReceipt(file: File): Promise<File> {
	// Some browsers (Windows/Linux) report no MIME for local PDFs; sniff extension too,
	// and stamp the type so the upload allowlist, worker and viewer all see a real PDF.
	if (receiptMediaKind(file.type) === "pdf") return file;
	if (/\.pdf$/i.test(file.name))
		return new File([file], file.name, { type: "application/pdf" });

	let image = file;
	if (isHeic(file)) {
		const { heicTo } = await import("heic-to");
		const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
		image = new File([jpeg], toJpegName(file.name), { type: "image/jpeg" });
	}

	const { default: compress } = await import("browser-image-compression");
	const out = await compress(image, COMPRESS);
	return new File([out], toJpegName(file.name), { type: "image/jpeg" });
}

function toJpegName(name: string): string {
	return `${name.replace(/\.[^.]+$/, "")}.jpg`;
}
