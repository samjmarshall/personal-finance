// Marks a prompt part as member content, so telemetry swaps it for a stub before
// export (adr015 §6). Writer and reader share this one home: if they drift, the
// part ships raw.
export const REDACT_IN_TELEMETRY = { observability: { redact: true } };

/** Whether a prompt part's provider options carry the redact tag. */
export function isRedactTagged(providerOptions: unknown): boolean {
	if (typeof providerOptions !== "object" || providerOptions === null)
		return false;
	const ns = (providerOptions as Record<string, unknown>).observability;
	return (
		typeof ns === "object" &&
		ns !== null &&
		(ns as Record<string, unknown>).redact === true
	);
}
