import { TRPCError } from "@trpc/server";

// Guards an insert/update `.returning()` that must yield a row. Logs the
// operation label only — never the input, which can carry user data — and
// throws a stable INTERNAL_SERVER_ERROR whose message names the operation.
export function assertRow<T>(row: T | undefined, operation: string): T {
	if (!row) {
		console.error(`Failed to ${operation}.`);
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to ${operation}.`,
		});
	}
	return row;
}
