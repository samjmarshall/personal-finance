/**
 * Public `LogLevel` name for logging code. Re-exported from env.ts, the single
 * source — env.ts defines the enum inline because Next's config transpiler
 * compiles env.ts (via next.config.ts) and can't resolve a deep `~` import out
 * of it. Importing here keeps logger.ts off the `~/env` graph directly.
 */
export { LogLevel } from "~/env";
