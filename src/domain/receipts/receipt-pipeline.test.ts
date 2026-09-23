import { describe, expect, it } from "vitest";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { ReceiptDetail } from "./receipt.interface";
import { receiptPipeline } from "./receipt-pipeline";

const CREATED = new Date("2026-09-23T01:00:00.000Z");
const UPDATED = new Date("2026-09-23T01:00:03.500Z");

function receipt(overrides: Partial<ReceiptDetail> = {}): ReceiptDetail {
	return {
		id: 7,
		status: ReceiptStatus.Processed,
		channel: ReceiptChannel.Upload,
		userId: "user-1",
		blobUrl: "https://blob/x",
		blobPathname: "receipts/x.png",
		contentType: "image/png",
		contentHash: "abc",
		vendor: "Woolworths",
		receiptDate: "2026-09-22",
		total: 42.5,
		currency: "AUD",
		rawJson: null,
		error: null,
		traceId: "0af7651916cd43dd8448eb211c80319c",
		transactionId: null,
		duplicateOfId: null,
		createdAt: CREATED,
		updatedAt: UPDATED,
		transactionDescription: null,
		traceUrl: null,
		items: [],
		...overrides,
	};
}

describe("receiptPipeline", () => {
	it("marks a duplicate deduplicated and skips extraction + match", () => {
		const stages = receiptPipeline(
			receipt({ status: ReceiptStatus.Duplicate, duplicateOfId: 3 }),
		);
		expect(stages.map((s) => [s.label, s.state])).toEqual([
			["Upload received", "ok"],
			["Deduplicated", "ok"],
			["AI extraction", "skipped"],
			["Transaction match", "skipped"],
		]);
		expect(stages[1]?.detail).toContain("#3");
	});

	it("shows extraction running and match waiting while pending", () => {
		const stages = receiptPipeline(receipt({ status: ReceiptStatus.Pending }));
		expect(stages.map((s) => [s.label, s.state])).toEqual([
			["Upload received", "ok"],
			["AI extraction", "active"],
			["Transaction match", "pending"],
		]);
	});

	it("surfaces the captured error on the failed extraction stage", () => {
		const stages = receiptPipeline(
			receipt({ status: ReceiptStatus.Failed, error: "model timeout" }),
		);
		expect(stages.map((s) => [s.label, s.state])).toEqual([
			["Upload received", "ok"],
			["AI extraction", "failed"],
			["Transaction match", "pending"],
		]);
		expect(stages[1]?.detail).toBe("model timeout");
	});

	it("confirms the match when a processed receipt is linked", () => {
		const stages = receiptPipeline(
			receipt({
				status: ReceiptStatus.Processed,
				transactionId: 99,
				transactionDescription: "WOOLWORTHS 1234",
			}),
		);
		expect(stages.map((s) => [s.label, s.state])).toEqual([
			["Upload received", "ok"],
			["AI extraction", "ok"],
			["Transaction match", "ok"],
		]);
		expect(stages[2]?.detail).toContain("WOOLWORTHS 1234");
	});

	it("leaves the match pending when a processed receipt is unmatched", () => {
		const stages = receiptPipeline(
			receipt({ status: ReceiptStatus.Processed, transactionId: null }),
		);
		expect(stages.map((s) => [s.label, s.state])).toEqual([
			["Upload received", "ok"],
			["AI extraction", "ok"],
			["Transaction match", "pending"],
		]);
	});

	it("stamps stages with the receipt's ISO timestamps", () => {
		const stages = receiptPipeline(
			receipt({ status: ReceiptStatus.Processed }),
		);
		expect(stages[0]?.at).toBe(CREATED.toISOString());
		expect(stages[1]?.at).toBe(UPDATED.toISOString());
	});
});
