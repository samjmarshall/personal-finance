import { context, trace } from "@opentelemetry/api";
import type { LogRecord } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { BaggageKey, setBaggage } from "./baggage";
import { LogLevel, OtelLogger } from "./logger";

type FakeRecord = LogRecord & { body?: string };

function makeHarness(level: LogLevel = LogLevel.DEBUG, pretty = false) {
	const emitCalls: FakeRecord[] = [];
	const stdoutLines: string[] = [];
	const emitter = { emit: (r: LogRecord) => emitCalls.push(r as FakeRecord) };
	const stdout = { write: (line: string) => stdoutLines.push(line) };
	const logger = new OtelLogger({ emitter, stdout, level, pretty });
	return { logger, emitCalls, stdoutLines };
}

const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
afterEach(() => vi.restoreAllMocks());

describe("OtelLogger", () => {
	it("maps debug/info/warn/error to correct severity numbers", () => {
		const { logger, emitCalls } = makeHarness();
		logger.debug("d");
		logger.info("i");
		logger.warn("w");
		logger.error("e");
		expect(emitCalls.map((c) => c.severityNumber)).toEqual([
			SeverityNumber.DEBUG,
			SeverityNumber.INFO,
			SeverityNumber.WARN,
			SeverityNumber.ERROR,
		]);
	});

	it("drops records below configured level from both sinks", () => {
		const { logger, emitCalls, stdoutLines } = makeHarness(LogLevel.WARN);
		logger.debug("d");
		logger.info("i");
		logger.warn("w");
		logger.error("e");
		expect(emitCalls).toHaveLength(2);
		expect(emitCalls[0]?.body).toBe("w");
		expect(stdoutLines).toHaveLength(2);
	});

	it("with() merges bound attrs; later with() wins on conflict", () => {
		const { logger, emitCalls } = makeHarness();
		logger
			.with({ domain: "a", key: "base" })
			.with({ key: "override" })
			.info("msg");
		expect(emitCalls[0]?.attributes).toMatchObject({
			domain: "a",
			key: "override",
		});
	});

	it("copies active baggage keys set via setBaggage + context.with", () => {
		const { logger, emitCalls } = makeHarness();
		const ctx = setBaggage({ [BaggageKey.MemberId]: "m1" });
		context.with(ctx, () => logger.info("msg"));
		expect(emitCalls[0]?.attributes?.["member.id"]).toBe("m1");
	});

	it("adds exception.* attrs for Error instances", () => {
		const { logger, emitCalls } = makeHarness();
		const err = new Error("oops");
		logger.error("failed", { error: err });
		expect(emitCalls[0]?.attributes).toMatchObject({
			"exception.type": "Error",
			"exception.message": "oops",
		});
		expect(typeof emitCalls[0]?.attributes?.["exception.stacktrace"]).toBe(
			"string",
		);
		// error field must be decomposed into exception.* — not emitted raw
		expect("error" in (emitCalls[0]?.attributes ?? {})).toBe(false);
	});

	it("adds exception.* attrs for non-Error values", () => {
		const { logger, emitCalls } = makeHarness();
		logger.error("failed", { error: "string-error" });
		expect(emitCalls[0]?.attributes).toMatchObject({
			"exception.type": "string",
			"exception.message": "string-error",
		});
	});

	it("lifts event.name to eventName and keeps the attribute", () => {
		const { logger, emitCalls } = makeHarness();
		logger.info("happened", { "event.name": "thing.happened" });
		const rec = emitCalls[0];
		expect((rec as unknown as { eventName?: string })?.eventName).toBe(
			"thing.happened",
		);
		expect(rec?.attributes?.["event.name"]).toBe("thing.happened");
	});

	it("stdout line is valid JSON carrying level, msg, and call attrs", () => {
		const { logger, stdoutLines } = makeHarness();
		logger.info("hello", { foo: "bar" });
		const parsed = JSON.parse(stdoutLines[0] ?? "{}");
		expect(parsed).toMatchObject({ level: "info", msg: "hello", foo: "bar" });
	});

	it("captures trace_id and span_id from the active span", () => {
		const { logger, emitCalls } = makeHarness();
		const tracer = trace.getTracer("test");
		tracer.startActiveSpan("test-span", (span) => {
			logger.info("inside span");
			span.end();
		});
		const attrs = emitCalls[0]?.attributes ?? {};
		expect(typeof attrs.trace_id).toBe("string");
		expect(typeof attrs.span_id).toBe("string");
	});

	// A sink throw must not reach the caller: the outbox logs after its tx commits
	// (adr002), so a throw would fail a durable write and duplicate rows.
	it("never throws when the emitter sink throws; falls back to console.error with the message", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = new OtelLogger({
			emitter: {
				emit: () => {
					throw new Error("otlp down");
				},
			},
			stdout: { write: () => {} },
			level: LogLevel.DEBUG,
			pretty: false,
		});

		expect(() => logger.info("hi")).not.toThrow();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("logging_failed"),
		);
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("hi"));
	});

	it("never throws when the stdout sink throws; falls back to console.error with the message", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = new OtelLogger({
			emitter: { emit: () => {} },
			stdout: {
				write: () => {
					throw new Error("EPIPE");
				},
			},
			level: LogLevel.DEBUG,
			pretty: false,
		});

		expect(() => logger.error("boom")).not.toThrow();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
	});
});
