// Names the action, never the input (may hold user data). A plain error stays a
// 500 that still reads "Failed to x."; no log, the request wrapper logs it once.
export function assertRow<T>(row: T | undefined, operation: string): T {
	if (!row) throw new Error(`Failed to ${operation}.`);
	return row;
}
