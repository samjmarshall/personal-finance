import { describe, expect, it } from "vitest";

import type { ReceiptDetail } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import {
	diagnosticsJson,
	fmtIso,
	fmtMs,
	metaRows,
	processingMs,
	rawJsonText,
} from "./more-details.display";

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

describe("fmtIso", () => {
	it("formats a real date as ISO-8601", () => {
		expect(fmtIso(CREATED)).toBe(CREATED.toISOString());
	});

	it("renders an em-dash for null/invalid", () => {
		expect(fmtIso(null)).toBe("—");
		expect(fmtIso("not-a-date")).toBe("—");
	});
});

describe("fmtMs", () => {
	it("renders an em-dash for null", () => {
		expect(fmtMs(null)).toBe("—");
	});

	it("uses ms under a second and one-decimal seconds at/over", () => {
		expect(fmtMs(999)).toBe("999 ms");
		expect(fmtMs(3500)).toBe("3.5 s");
	});
});

describe("processingMs", () => {
	it("is the wall-clock gap for an updated, unmatched receipt", () => {
		expect(processingMs(receipt())).toBe(3500);
	});

	it("is null before the first update", () => {
		expect(processingMs(receipt({ updatedAt: null }))).toBeNull();
	});

	it("is null once matched — updatedAt is then the member's confirm time", () => {
		expect(processingMs(receipt({ transactionId: 99 }))).toBeNull();
	});

	it("is null when the clocks disagree (negative)", () => {
		expect(
			processingMs(receipt({ updatedAt: new Date(CREATED.getTime() - 1000) })),
		).toBeNull();
	});
});

describe("metaRows", () => {
	it("renders an em-dash for a null trace id and hides processing time once matched", () => {
		const rows = Object.fromEntries(
			metaRows(receipt({ transactionId: 99 }), null),
		);
		expect(rows["Ingest trace ID"]).toBe("—");
		expect(rows["Processing time"]).toBe("—");
		expect(rows["Transaction ID"]).toBe("#99");
	});
});

describe("diagnosticsJson", () => {
	it("emits valid JSON carrying the trace id and item count", () => {
		const parsed = JSON.parse(
			diagnosticsJson(receipt({ items: [{}, {}] as never }), "trace-1"),
		);
		expect(parsed.traceId).toBe("trace-1");
		expect(parsed.receiptId).toBe(7);
		expect(parsed.itemCount).toBe(2);
	});
});

describe("rawJsonText", () => {
	it("returns a placeholder comment when no extraction is stored", () => {
		expect(rawJsonText(receipt({ rawJson: null }))).toBe(
			"// no raw extraction stored for this receipt",
		);
	});

	it("pretty-prints stored raw extraction", () => {
		expect(rawJsonText(receipt({ rawJson: { vendor: "W" } }))).toBe(
			'{\n  "vendor": "W"\n}',
		);
	});
});
