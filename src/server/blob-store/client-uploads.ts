import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";

/** What Blob signs into a client token: the policy the browser's upload obeys. */
export type UploadGrant = Awaited<
	ReturnType<Parameters<typeof handleUpload>[0]["onBeforeGenerateToken"]>
>;

/** Blob's browser-direct upload handshake. */
export interface ClientUploads {
	/** `grant` runs only for a token request; a throw from it reaches the caller. */
	answer(
		request: Request,
		event: HandleUploadBody,
		grant: (pathname: string) => Promise<UploadGrant>,
	): Promise<unknown>;
}

export class VercelClientUploads implements ClientUploads {
	answer(
		request: Request,
		event: HandleUploadBody,
		grant: (pathname: string) => Promise<UploadGrant>,
	): Promise<unknown> {
		return handleUpload({
			request,
			body: event,
			onBeforeGenerateToken: grant,
			onUploadCompleted: async () => {
				// Kept so Blob still sets a callback URL on the token. Empty: receipt.create
				// owns the row, since Blob's webhook can't reach localhost.
			},
		});
	}
}
