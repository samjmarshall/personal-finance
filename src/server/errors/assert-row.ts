// Guards an insert/update that must return a row. Names the operation, never the
// input (can carry user data). A plain Error: the tRPC error-mapping middleware
// leaves it as INTERNAL_SERVER_ERROR, and TRPCError falls back to `cause.message`,
// so the member still sees "Failed to x.". No logging here — the tRPC request
// wrapper already logs every failed call once, so it'd only double it.
export function assertRow<T>(row: T | undefined, operation: string): T {
	if (!row) throw new Error(`Failed to ${operation}.`);
	return row;
}
