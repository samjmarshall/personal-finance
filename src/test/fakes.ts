/**
 * Stand-in methods shared by the service and controller unit tests. Not a
 * *.test.ts, so vitest never collects it.
 */

/** A fake method that resolves `result` and keeps each call's arguments. */
export function recorder<T>(result: T) {
	const calls: unknown[][] = [];
	const method = async (...args: unknown[]) => {
		calls.push(args);
		return result;
	};
	return { method, calls };
}

/** A fake method that rejects with `error`. */
export const throwing = (error: Error) => async (): Promise<never> => {
	throw error;
};

// Fills the methods a test didn't stage, so an unexpected call fails loudly.
export const unstaged = async (): Promise<never> => {
	throw new Error("not staged");
};

// Production shape: drizzle wraps the postgres.js error in a DrizzleQueryError
// with the driver error on `.cause`.
export function failedQuery(code: string) {
	const driver = Object.assign(new Error("postgres"), { code });
	return Object.assign(new Error("Failed query"), { cause: driver });
}
