import { ReceiptStatus } from "~/lib/constants";
import type { ReceiptDetail } from "./receipt.interface";

export type StageState = "ok" | "active" | "failed" | "skipped" | "pending";
export type Stage = {
	label: string;
	state: StageState;
	detail: string;
	// ISO-8601 stamp, or null when the stage has no real time (running, skipped, or
	// unknown). The display layer, not this type, decides how "no time" renders.
	at: string | null;
};

// ISO-8601 for a real timestamp, else null (absent/invalid). No display marker —
// the "—" fallback belongs to the render layer, not this pure derivation.
export function isoOrNull(d: Date | string | null | undefined): string | null {
	if (!d) return null;
	const t = new Date(d);
	return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

// The ingest pipeline inferred from the receipt's status: Upload → AI extraction →
// Transaction match, with Duplicate/Pending/Failed short-circuiting. State-only —
// real per-stage span timings live in PostHog, reached via the "Open trace" link.
export function receiptPipeline(data: ReceiptDetail): Stage[] {
	const created = isoOrNull(data.createdAt);
	const updated = isoOrNull(data.updatedAt);
	const upload: Stage = {
		label: "Upload received",
		state: "ok",
		detail: `${data.channel} · ${data.contentType ?? "unknown type"}`,
		at: created,
	};

	switch (data.status) {
		case ReceiptStatus.Duplicate:
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
					at: null,
				},
				{
					label: "Transaction match",
					state: "skipped",
					detail: "Not applicable",
					at: null,
				},
			];

		case ReceiptStatus.Pending:
			return [
				upload,
				{
					label: "AI extraction",
					state: "active",
					detail: "Running in Inngest…",
					at: null,
				},
				{
					label: "Transaction match",
					state: "pending",
					detail: "Waiting on extraction",
					at: null,
				},
			];

		case ReceiptStatus.Failed:
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
					at: null,
				},
			];

		case ReceiptStatus.Processed: {
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
					// updatedAt is the row's last state change, not a stage clock. A match
					// lands later and overwrites it, so we can only honestly stamp extraction
					// time while it is still the last write (unmatched). Matched → unknown.
					at: matched ? null : updated,
				},
				matched
					? {
							label: "Transaction match",
							state: "ok",
							detail: `Confirmed: ${data.transactionDescription ?? `#${data.transactionId}`}`,
							at: updated,
						}
					: {
							label: "Transaction match",
							state: "pending",
							detail: "Awaiting member confirmation",
							at: null,
						},
			];
		}

		// A new ReceiptStatus must be handled above, not silently rendered as a green
		// "Processed" pipeline: the `never` binding turns that omission into a build error.
		default: {
			const unhandled: never = data.status;
			throw new Error(`Unhandled receipt status: ${String(unhandled)}`);
		}
	}
}
