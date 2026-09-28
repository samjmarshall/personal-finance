import {
	logs,
	type Logger as OtelApiLogger,
	SeverityNumber,
} from "@opentelemetry/api-logs";
import { env, LogLevel } from "~/env";
import { errorMessage, errorName } from "~/server/observability/errors/thrown";
import { readBaggage } from "~/server/observability/tracing/baggage";
import { currentSpanContext } from "~/server/observability/tracing/current-trace-id";

// Re-exported so logging code depends on the logger, not env.ts, for the level name.
export { LogLevel };

/**
 * Attrs callers pass to each log call. Accepts unknown values so `error: Error`
 * is ergonomic inline — only the error is broken into strings; pass the rest as
 * primitives.
 */
export type LogAttributes = Record<string, unknown>;

export interface Logger {
	debug(msg: string, attrs?: LogAttributes): void;
	info(msg: string, attrs?: LogAttributes): void;
	warn(msg: string, attrs?: LogAttributes): void;
	/** Pass `{ error: someError }` to attach exception.* attributes. */
	error(msg: string, attrs?: LogAttributes & { error?: unknown }): void;
	/** Returns a new Logger with `attrs` merged into every subsequent call. */
	with(attrs: LogAttributes): Logger;
}

interface OtelLoggerDeps {
	emitter: Pick<OtelApiLogger, "emit">;
	stdout: { write(line: string): void };
	level: LogLevel;
	pretty: boolean;
	bound?: LogAttributes;
}

const SEVERITY: Record<LogLevel, { number: SeverityNumber; text: string }> = {
	debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
	info: { number: SeverityNumber.INFO, text: "INFO" },
	warn: { number: SeverityNumber.WARN, text: "WARN" },
	error: { number: SeverityNumber.ERROR, text: "ERROR" },
};

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export class OtelLogger implements Logger {
	private readonly emitter: OtelLoggerDeps["emitter"];
	private readonly stdout: OtelLoggerDeps["stdout"];
	private readonly level: LogLevel;
	private readonly pretty: boolean;
	private readonly bound: LogAttributes;

	constructor(deps: OtelLoggerDeps) {
		this.emitter = deps.emitter;
		this.stdout = deps.stdout;
		this.level = deps.level;
		this.pretty = deps.pretty;
		this.bound = deps.bound ?? {};
	}

	private log(
		level: LogLevel,
		msg: string,
		attrs?: LogAttributes & { error?: unknown },
	): void {
		try {
			if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

			const { error, err, ...callAttrs } = attrs ?? {};
			// `err` is the Pino/Inngest convention (Inngest.js logs `{ err }`); alias it
			// to `error` so object-first loggers get exception decomposition instead of
			// shipping a raw Error that serialises to {} and leaks into OTLP attributes.
			const exception = error ?? err;

			const spanCtx = currentSpanContext();
			const spanAttrs: LogAttributes = spanCtx
				? { trace_id: spanCtx.traceId, span_id: spanCtx.spanId }
				: {};

			const errorAttrs: LogAttributes = {};
			if (exception !== undefined) {
				if (exception instanceof Error) {
					errorAttrs["exception.type"] = exception.name;
					// TODO(security): an error's message and stack can carry private data
					// (emails, database values, ids) and reach the analytics service three
					// ways — the log, the trace, and error tracking. Scrub before it
					// leaves; keep the full text in local output only.
					errorAttrs["exception.message"] = exception.message;
					errorAttrs["exception.stacktrace"] = exception.stack ?? "";
				} else {
					errorAttrs["exception.type"] = errorName(exception);
					errorAttrs["exception.message"] = errorMessage(exception);
				}
			}

			// Precedence low→high: ambient baggage is weakest, so an explicit call arg
			// (e.g. the row id a warn names) wins over the active baggage id. Span/error
			// attrs are system-computed and win last so a caller can't spoof them.
			const allAttrs: LogAttributes = {
				...readBaggage(),
				...this.bound,
				...callAttrs,
				...spanAttrs,
				...errorAttrs,
			};

			// event.name is mirrored onto the record's eventName field (adr015 §5)
			// so PostHog exposes it as a filterable field; the attribute is kept too.
			const eventName = allAttrs["event.name"] as string | undefined;

			const { number: severityNumber, text: severityText } = SEVERITY[level];

			// Caller values pass through as given, unchecked. Only the error was broken
			// into strings above, so it can't ship as an empty object.
			this.emitter.emit({
				severityNumber,
				severityText,
				body: msg,
				// biome-ignore lint/suspicious/noExplicitAny: attrs are unknown; AnyValueMap needs a cast
				attributes: allAttrs as any,
				...(eventName !== undefined ? { eventName } : {}),
			});

			const line = JSON.stringify(
				{ level, msg, ...allAttrs },
				null,
				this.pretty ? 2 : 0,
			);
			this.stdout.write(`${line}\n`);
		} catch (error) {
			// Logging must not crash the caller (the outbox logs after its tx commits —
			// adr002 — so a throw duplicates a durable write). console.error won't throw
			// on a broken stream (Node ignoreErrors); a string arg dodges a util.inspect
			// throw. Keep level+msg so the event isn't wholly lost.
			const detail =
				error instanceof Error ? (error.stack ?? error.message) : String(error);
			console.error(`logging_failed level=${level} msg=${msg} ${detail}`);
		}
	}

	debug(msg: string, attrs?: LogAttributes): void {
		this.log(LogLevel.DEBUG, msg, attrs);
	}

	info(msg: string, attrs?: LogAttributes): void {
		this.log(LogLevel.INFO, msg, attrs);
	}

	warn(msg: string, attrs?: LogAttributes): void {
		this.log(LogLevel.WARN, msg, attrs);
	}

	error(msg: string, attrs?: LogAttributes & { error?: unknown }): void {
		this.log(LogLevel.ERROR, msg, attrs);
	}

	with(attrs: LogAttributes): Logger {
		return new OtelLogger({
			emitter: this.emitter,
			stdout: this.stdout,
			level: this.level,
			pretty: this.pretty,
			bound: { ...this.bound, ...attrs },
		});
	}
}

/**
 * Builds the root logger bound to the OTel global logger and process.stdout.
 * pretty output keys off NODE_ENV.
 * Call once per composition root; tiers call `root.with({ domain, component })`.
 */
export function createRootLogger(): OtelLogger {
	return new OtelLogger({
		emitter: logs.getLogger(env.PROJECT_NAME),
		stdout: process.stdout,
		level: env.LOG_LEVEL,
		pretty: process.env.NODE_ENV === "development",
	});
}
