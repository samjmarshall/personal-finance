import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { captureException } from "./posthog";

/** Raises an Error Tracking issue and logs the same error with the same attrs. Choke points only. */
export function reportError(
	logger: Logger,
	msg: string,
	error: unknown,
	attrs: LogAttributes,
): void {
	captureException(error, attrs);
	logger.error(msg, { error, ...attrs });
}
