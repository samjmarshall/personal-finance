import { handleUpload } from "@vercel/blob/client";
import { describe, expect, it, vi } from "vitest";
import { VercelClientUploads } from "./client-uploads";

vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));

const handleUploadMock = vi.mocked(handleUpload);

const event = {
	type: "blob.generate-client-token",
	payload: {
		pathname: "receipts/a.jpg",
		callbackUrl: "https://ledger.test/api/receipts/upload",
		clientPayload: null,
		multipart: false,
	},
} as const;

describe("VercelClientUploads.answer", () => {
	it("hands Blob the request, the event and the grant as its token hook", async () => {
		handleUploadMock.mockResolvedValue({
			type: "blob.generate-client-token",
			clientToken: "tok",
		});
		const request = new Request("https://ledger.test/api/receipts/upload");
		const grant = async () => ({ addRandomSuffix: true });

		const answer = await new VercelClientUploads().answer(
			request,
			event,
			grant,
		);

		expect(answer).toEqual({
			type: "blob.generate-client-token",
			clientToken: "tok",
		});
		const [options] = handleUploadMock.mock.calls[0] ?? [];
		expect(options?.request).toBe(request);
		expect(options?.body).toBe(event);
		expect(options?.onBeforeGenerateToken).toBe(grant);
	});

	// Blob only sets the callback URL on the token when a completion hook exists.
	it("passes a completion hook that does nothing", async () => {
		handleUploadMock.mockResolvedValue({
			type: "blob.upload-completed",
			response: "ok",
		});

		await new VercelClientUploads().answer(
			new Request("https://ledger.test/api/receipts/upload"),
			event,
			async () => ({}),
		);

		const [options] = handleUploadMock.mock.calls[0] ?? [];
		expect(options?.onUploadCompleted).toBeTypeOf("function");
		await expect(
			options?.onUploadCompleted?.({} as never),
		).resolves.toBeUndefined();
	});

	it("lets a Blob refusal propagate", async () => {
		const refusal = new Error("Invalid callback signature");
		handleUploadMock.mockRejectedValue(refusal);

		await expect(
			new VercelClientUploads().answer(
				new Request("https://ledger.test/api/receipts/upload"),
				event,
				async () => ({}),
			),
		).rejects.toBe(refusal);
	});
});
