import { del, get, put } from "@vercel/blob";

export interface FetchedBlob {
	bytes: Uint8Array;
	mediaType: string;
}

/** Where the store put a blob; both are what a caller records. */
export interface StoredBlobLocation {
	url: string;
	pathname: string;
}

/** Blob bytes, keyed by store-relative pathname. */
export interface BlobStore {
	/** Throws when the blob is missing or the store refuses the read. */
	read(pathname: string): Promise<FetchedBlob>;
	/** Private write keyed exactly by `pathname` (no random suffix). Throws on refusal. */
	write(
		pathname: string,
		body: string | Uint8Array,
		contentType: string,
	): Promise<StoredBlobLocation>;
	/** Throws when the store refuses the delete. */
	delete(pathname: string): Promise<void>;
}

/**
 * Vercel Blob adapter. The store is private, so a bare fetch of the URL 400s — go
 * through the SDK's `get`, which signs with BLOB_READ_WRITE_TOKEN from the env.
 * Pathname-keyed so a read is pinned to our own store, never a foreign URL.
 */
export class VercelBlobStore implements BlobStore {
	async read(pathname: string): Promise<FetchedBlob> {
		const result = await get(pathname, { access: "private" });
		if (result?.statusCode !== 200) {
			throw new Error(`blob fetch failed for ${pathname}`);
		}
		const bytes = new Uint8Array(
			await new Response(result.stream).arrayBuffer(),
		);
		return { bytes, mediaType: result.blob.contentType };
	}

	// addRandomSuffix off: the pathname the caller minted is the key the row records,
	// and both read sinks (the worker, the image proxy) resolve by it.
	async write(
		pathname: string,
		body: string | Uint8Array,
		contentType: string,
	): Promise<StoredBlobLocation> {
		// The SDK's PutBody has no Uint8Array arm, so bytes are wrapped here rather
		// than making the service carry a Buffer in its types.
		const result = await put(
			pathname,
			typeof body === "string" ? body : Buffer.from(body),
			{ access: "private", contentType, addRandomSuffix: false },
		);
		return { url: result.url, pathname: result.pathname };
	}

	delete(pathname: string): Promise<void> {
		return del(pathname);
	}
}
