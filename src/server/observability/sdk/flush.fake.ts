import { vi } from "vitest";

// Test stand-in for ./flush: runs the real handler, records one flush per request.
export const flushAfterResponse = vi.fn();

export function withFlush<Args extends unknown[], Result>(
	handler: (...args: Args) => Result,
): (...args: Args) => Result {
	return (...args) => {
		flushAfterResponse();
		return handler(...args);
	};
}
