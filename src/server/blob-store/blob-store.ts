import { del, get, put } from "@vercel/blob";
import { owns } from "./blob-prefix";

export interface FetchedBlob {
	bytes: Uint8Array;
	mediaType: string;
}

/** A blob still on the wire, for piping to a response without buffering. */
export interface StreamedBlob {
	stream: ReadableStream<Uint8Array>;
	contentType: string;
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
	/** `null` when the store has no such blob; throws when it refuses the read. */
	stream(pathname: string): Promise<StreamedBlob | null>;
	/**
	 * Private write keyed by `pathname` under this environment's prefix (no random
	 * suffix). Returns the prefixed pathname to record. Throws on refusal.
	 */
	write(
		pathname: string,
		body: string | Uint8Array,
		contentType: string,
	): Promise<StoredBlobLocation>;
	/**
	 * No-op for a file this environment doesn't own. Throws when the store refuses
	 * the delete.
	 */
	delete(pathname: string): Promise<void>;
}

export interface VercelBlobStoreDeps {
	/** `""` for production, else `local/<branch>/` or `preview/<branch>/`. */
	prefix: string;
}

/**
 * Vercel Blob adapter. The store is private, so a bare fetch of the URL 400s — go
 * through the SDK's `get`, which signs with BLOB_READ_WRITE_TOKEN from the env.
 * Pathname-keyed so a read is pinned to our own store, never a foreign URL.
 * One store serves every environment (adr028): a branch writes and deletes only
 * under its `prefix`, but reads anywhere, so it sees the files it inherited.
 */
export class VercelBlobStore implements BlobStore {
	private readonly prefix: string;

	constructor({ prefix }: VercelBlobStoreDeps) {
		this.prefix = prefix;
	}

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

	async stream(pathname: string): Promise<StreamedBlob | null> {
		const result = await get(pathname, { access: "private" });
		if (result?.statusCode !== 200) return null;
		return { stream: result.stream, contentType: result.blob.contentType };
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
			this.prefix + pathname,
			typeof body === "string" ? body : Buffer.from(body),
			{ access: "private", contentType, addRandomSuffix: false },
		);
		return { url: result.url, pathname: result.pathname };
	}

	async delete(pathname: string): Promise<void> {
		if (!owns(this.prefix, pathname)) return;
		await del(pathname);
	}
}
