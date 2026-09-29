import { ConflictError } from "./domain-errors";
import { isPgViolation, PgViolation } from "./parse-error";

// A 23503 means the member deleted the referenced row in another tab. Rethrow it
// as a ConflictError with the caller's message; pass anything else through untouched.
export function rethrowFkConflict(error: unknown, message: string): never {
	if (isPgViolation(error, PgViolation.ForeignKeyViolation)) {
		throw new ConflictError(message, { cause: error });
	}
	throw error;
}
