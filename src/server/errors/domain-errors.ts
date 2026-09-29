// Transport-free domain errors: services throw these, and the tRPC error-mapping
// middleware turns each into its code. The message is member-facing copy.

export class NotFoundError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "NotFoundError";
	}
}

export class ConflictError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ConflictError";
	}
}
