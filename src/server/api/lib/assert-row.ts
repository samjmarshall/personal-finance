import { TRPCError } from "@trpc/server";

// Guards an insert/update that must return a row. Throws a stable 500 naming the
// operation, never the input (can carry user data). No logging here — the tRPC
// request wrapper already logs every failed call once, so it'd only double it.
export function assertRow<T>(row: T | undefined, operation: string): T {
	if (!row) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to ${operation}.`,
		});
	}
	return row;
}
