// Transport-free domain errors: services throw these, and each transport maps the
// `kind` to its own code (tRPC in `trpc.ts`, HTTP in `http-status.ts`). The
// message is member-facing copy.

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

// Each sets its literal `name`: a minified build renames classes, so
// `constructor.name` can't be trusted in logs.

export class NotFoundError extends DomainError {
	readonly kind = "not_found" as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "NotFoundError";
	}
}

export class ConflictError extends DomainError {
	readonly kind = "conflict" as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ConflictError";
	}
}

export class InvalidInputError extends DomainError {
	readonly kind = "invalid_input" as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "InvalidInputError";
	}
}

export class UnauthorizedError extends DomainError {
	readonly kind = "unauthorized" as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "UnauthorizedError";
	}
}
