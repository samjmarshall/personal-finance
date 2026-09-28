import { isoOrNull, type ReceiptDetail } from "~/domain/receipts";

// Pure display helpers for the receipt diagnostics overlay. Kept out of the .tsx so
// they run under the node test env (no DOM needed) — the component wires them up.

// Display form of the domain derivation: an ISO stamp, or "—" when there's no time.
export function fmtIso(d: Date | string | null | undefined): string {
	return isoOrNull(d) ?? "—";
}

// Wall-clock createdAt→updatedAt; null when the receipt hasn't been updated yet,
// the clocks disagree (negative), or a match landed (updatedAt is then the member's
// confirm time — hours of idle, not processing), so callers render "—" not a lie.
export function processingMs(data: ReceiptDetail): number | null {
	if (!data.updatedAt || data.transactionId != null) return null;
	const ms =
		new Date(data.updatedAt).getTime() - new Date(data.createdAt).getTime();
	return ms >= 0 ? ms : null;
}

export function fmtMs(ms: number | null): string {
	if (ms == null) return "—";
	return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function metaRows(data: ReceiptDetail): Array<[string, string]> {
	return [
		["Ingest trace ID", data.traceId ?? "—"],
		["Receipt ID", `#${data.id}`],
		["Status", data.status],
		["Channel", data.channel],
		["Content type", data.contentType ?? "—"],
		["Content hash", data.contentHash ?? "—"],
		["Blob pathname", data.blobPathname],
		[
			"Transaction ID",
			data.transactionId != null ? `#${data.transactionId}` : "—",
		],
		[
			"Duplicate of",
			data.duplicateOfId != null ? `#${data.duplicateOfId}` : "—",
		],
		["Items extracted", String(data.items.length)],
		["Created", fmtIso(data.createdAt)],
		["Updated", fmtIso(data.updatedAt)],
		["Processing time", fmtMs(processingMs(data))],
	];
}

export function diagnosticsJson(data: ReceiptDetail): string {
	return JSON.stringify(
		{
			traceId: data.traceId,
			receiptId: data.id,
			status: data.status,
			channel: data.channel,
			contentType: data.contentType,
			contentHash: data.contentHash,
			blobPathname: data.blobPathname,
			transactionId: data.transactionId,
			duplicateOfId: data.duplicateOfId,
			createdAt: data.createdAt,
			updatedAt: data.updatedAt,
			error: data.error,
			vendor: data.vendor,
			total: data.total,
			currency: data.currency,
			receiptDate: data.receiptDate,
			itemCount: data.items.length,
			rawExtraction: data.rawJson,
		},
		null,
		2,
	);
}

export function rawJsonText(data: ReceiptDetail): string {
	if (data.rawJson == null)
		return "// no raw extraction stored for this receipt";
	return JSON.stringify(data.rawJson, null, 2);
}
