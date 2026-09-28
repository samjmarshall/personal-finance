/** The error's class name, or its `typeof` when something other than an Error was thrown. */
export function errorName(error: unknown): string {
	return error instanceof Error ? error.name : typeof error;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// A thrown plain object turns into "[object Object]" as a string; JSON keeps its fields.
export function stringifyThrown(error: unknown): string {
	if (typeof error !== "object" || error === null) return String(error);
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}
