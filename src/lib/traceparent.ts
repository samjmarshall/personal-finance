// W3C traceparent minted in the browser so the server span parents onto the
// client's trace (adr018). Pure + isomorphic: crypto.getRandomValues only, no
// OTel. Flags always `01` — parentbased_always_on then records the span.

function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	// W3C forbids an all-zero id; a zero byte flips to 01 so the id stays valid.
	if (buf.every((b) => b === 0)) buf[0] = 1;
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// `00-<32 hex trace id>-<16 hex span id>-01`.
export function newTraceparent(): string {
	return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

export function traceIdOf(traceparent: string): string {
	return traceparent.split("-")[1] ?? "";
}
