import { describe, expect, it } from "vitest";

import {
	CommitmentKind,
	ReceiptChannel,
	ReceiptStatus,
	toCommitmentKind,
	toReceiptChannel,
	toReceiptStatus,
} from "./constants";

describe("toCommitmentKind", () => {
	it("maps the managed vocab through unchanged", () => {
		expect(toCommitmentKind("recurring")).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind("one-time")).toBe(CommitmentKind.OneTime);
	});

	it("coerces an out-of-vocab value to Recurring", () => {
		expect(toCommitmentKind("weekly")).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind(null)).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind(undefined)).toBe(CommitmentKind.Recurring);
	});
});

describe("toReceiptStatus", () => {
	it("maps the managed vocab through unchanged", () => {
		expect(toReceiptStatus("pending")).toBe(ReceiptStatus.Pending);
		expect(toReceiptStatus("processed")).toBe(ReceiptStatus.Processed);
		expect(toReceiptStatus("failed")).toBe(ReceiptStatus.Failed);
		expect(toReceiptStatus("duplicate")).toBe(ReceiptStatus.Duplicate);
	});

	it("coerces an out-of-vocab value to Pending", () => {
		expect(toReceiptStatus("archived")).toBe(ReceiptStatus.Pending);
		expect(toReceiptStatus(null)).toBe(ReceiptStatus.Pending);
		expect(toReceiptStatus(undefined)).toBe(ReceiptStatus.Pending);
	});
});

describe("toReceiptChannel", () => {
	it("maps the managed vocab through unchanged", () => {
		expect(toReceiptChannel("upload")).toBe(ReceiptChannel.Upload);
		expect(toReceiptChannel("email")).toBe(ReceiptChannel.Email);
	});

	it("coerces an out-of-vocab value to Upload", () => {
		expect(toReceiptChannel("sms")).toBe(ReceiptChannel.Upload);
		expect(toReceiptChannel(null)).toBe(ReceiptChannel.Upload);
		expect(toReceiptChannel(undefined)).toBe(ReceiptChannel.Upload);
	});
});
