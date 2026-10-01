import { ConflictError } from "./domain-errors";
import { isPgViolation, PgViolation } from "./parse-error";

// A missing linked row means the member deleted it in another tab: a conflict
// they can fix, not a server fault. Anything else passes through untouched.
export function rethrowFkConflict(error: unknown, message: string): never {
	if (isPgViolation(error, PgViolation.ForeignKeyViolation)) {
		throw new ConflictError(message, { cause: error });
	}
	throw error;
}
