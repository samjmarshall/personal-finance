import { trace } from "@opentelemetry/api";
import {
	logs,
	type Logger as OtelApiLogger,
	SeverityNumber,
} from "@opentelemetry/api-logs";
import { env } from "~/env";
import { readBaggage } from "./baggage";
import { LogLevel } from "./log-level";

export { LogLevel };

/**
 * Attrs callers pass to each log call. Accepts unknown values so `error: Error`
 * is ergonomic inline — the implementation filters to primitives before emitting.
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
		if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

		const { error, ...callAttrs } = attrs ?? {};

		// Active span context — present when inside an instrumented request.
		const spanCtx = trace.getActiveSpan()?.spanContext();
		const spanAttrs: LogAttributes = spanCtx
			? { trace_id: spanCtx.traceId, span_id: spanCtx.spanId }
			: {};

		const errorAttrs: LogAttributes = {};
		if (error !== undefined) {
			if (error instanceof Error) {
				errorAttrs["exception.type"] = error.name;
				// TODO(security): exception.message/.stacktrace can carry PII (inbound
				// emails, pg constraint values, account ids) and are exported to
				// PostHog. Sanitise before emit — keep full detail on stdout only.
				// See Phase 1 /security-review finding.
				errorAttrs["exception.message"] = error.message;
				errorAttrs["exception.stacktrace"] = error.stack ?? "";
			} else {
				errorAttrs["exception.type"] = typeof error;
				errorAttrs["exception.message"] = String(error);
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

		// allAttrs contains only primitives we built (strings, numbers, booleans).
		// Cast to AnyValueMap — the Error is decomposed to strings above before here.
		this.emitter.emit({
			severityNumber,
			severityText,
			body: msg,
			// biome-ignore lint/suspicious/noExplicitAny: AnyValueMap requires a cast here; allAttrs holds only primitives
			attributes: allAttrs as any,
			...(eventName !== undefined ? { eventName } : {}),
		});

		const line = JSON.stringify(
			{ level, msg, ...allAttrs },
			null,
			this.pretty ? 2 : 0,
		);
		this.stdout.write(`${line}\n`);
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
 * LOG_LEVEL comes validated from ~/env — its z.enum throws on a typo, so a bad
 * value fails at boot rather than silently degrading to dropped logs; pretty
 * output keys off NODE_ENV. Call once per composition root; tiers call
 * `root.with({ domain, component })`.
 */
export function createRootLogger(): OtelLogger {
	return new OtelLogger({
		emitter: logs.getLogger("personal-finance"),
		stdout: process.stdout,
		level: env.LOG_LEVEL,
		pretty: process.env.NODE_ENV === "development",
	});
}
