import { DomainError, type DomainErrorKind } from "./domain-errors";

// A `Record` so a new kind fails the typecheck until it has a status.
const HTTP_STATUS: Record<DomainErrorKind, number> = {
	not_found: 404,
	conflict: 409,
	invalid_input: 400,
	unauthorized: 401,
};

/** The HTTP status for a domain error; `undefined` for anything else. */
export function httpStatusFor(error: unknown): number | undefined {
	return error instanceof DomainError ? HTTP_STATUS[error.kind] : undefined;
}
