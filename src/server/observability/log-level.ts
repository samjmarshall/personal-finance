/**
 * Log severity levels (debug→error), in their own leaf module so `~/env` — which
 * every client and edge bundle imports — can read the enum without dragging
 * logger.ts and its @opentelemetry/api-logs graph into those bundles. logger.ts
 * imports and re-exports it as the public logging name; no imports here keeps
 * both sides cycle-proof.
 */
export enum LogLevel {
	DEBUG = "debug",
	INFO = "info",
	WARN = "warn",
	ERROR = "error",
}
