import { ReceiptStatus } from "~/lib/constants";
import type { ReceiptDetail } from "./receipt.interface";

export type StageState = "ok" | "active" | "failed" | "skipped" | "pending";
export type Stage = {
	label: string;
	state: StageState;
	detail: string;
	at: string;
};

// ISO-8601, or "—" when the timestamp is absent/invalid — the stamp shown against
// a stage. A stage with no real time yet (still running, skipped) also reads "—".
function fmtIso(d: Date | string | null | undefined): string {
	if (!d) return "—";
	const t = new Date(d);
	return Number.isNaN(t.getTime()) ? "—" : t.toISOString();
}

// The ingest pipeline inferred from the receipt's status: Upload → AI extraction →
// Transaction match, with Duplicate/Pending/Failed short-circuiting. State-only —
// real per-stage span timings live in PostHog, reached via the "Open trace" link.
export function receiptPipeline(data: ReceiptDetail): Stage[] {
	const created = fmtIso(data.createdAt);
	const updated = fmtIso(data.updatedAt);
	const upload: Stage = {
		label: "Upload received",
		state: "ok",
		detail: `${data.channel} · ${data.contentType ?? "unknown type"}`,
		at: created,
	};

	if (data.status === ReceiptStatus.Duplicate)
		return [
			upload,
			{
				label: "Deduplicated",
				state: "ok",
				detail: `Same content hash as #${data.duplicateOfId ?? "?"} — skipped AI extraction`,
				at: updated,
			},
			{
				label: "AI extraction",
				state: "skipped",
				detail: "Skipped (duplicate)",
				at: "—",
			},
			{
				label: "Transaction match",
				state: "skipped",
				detail: "Not applicable",
				at: "—",
			},
		];

	if (data.status === ReceiptStatus.Pending)
		return [
			upload,
			{
				label: "AI extraction",
				state: "active",
				detail: "Running in Inngest…",
				at: "—",
			},
			{
				label: "Transaction match",
				state: "pending",
				detail: "Waiting on extraction",
				at: "—",
			},
		];

	if (data.status === ReceiptStatus.Failed)
		return [
			upload,
			{
				label: "AI extraction",
				state: "failed",
				detail: data.error ?? "Extraction failed (no message captured)",
				at: updated,
			},
			{
				label: "Transaction match",
				state: "pending",
				detail: "Blocked by failure — retry to continue",
				at: "—",
			},
		];

	// Processed.
	const extractDetail = [
		data.vendor ? `vendor "${data.vendor}"` : "no vendor",
		data.total != null ? `total ${data.total}` : "no total",
		`${data.items.length} item${data.items.length === 1 ? "" : "s"}`,
	].join(" · ");
	const matched = data.transactionId != null;
	return [
		upload,
		{
			label: "AI extraction",
			state: "ok",
			detail: extractDetail,
			at: updated,
		},
		matched
			? {
					label: "Transaction match",
					state: "ok",
					detail: `Confirmed → ${data.transactionDescription ?? `#${data.transactionId}`}`,
					at: updated,
				}
			: {
					label: "Transaction match",
					state: "pending",
					detail: "Awaiting member confirmation",
					at: "—",
				},
	];
}
