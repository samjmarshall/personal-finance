// Transport-free domain errors: services throw these, each transport maps them to
// its own code. Message is member-facing copy.

export type DomainErrorKind =
	| "not_found"
	| "conflict"
	| "invalid_input"
	| "unauthorized";

export abstract class DomainError extends Error {
	abstract readonly kind: DomainErrorKind;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
	}
}

// Each sets its own name: minified builds rename classes, so the class name can't
// be trusted in logs.

export class NotFoundError extends DomainError {
	readonly kind = "not_found" as const;
	override readonly name = "NotFoundError";
}

export class ConflictError extends DomainError {
	readonly kind = "conflict" as const;
	override readonly name = "ConflictError";
}

export class InvalidInputError extends DomainError {
	readonly kind = "invalid_input" as const;
	override readonly name = "InvalidInputError";
}

export class UnauthorizedError extends DomainError {
	readonly kind = "unauthorized" as const;
	override readonly name = "UnauthorizedError";
}
