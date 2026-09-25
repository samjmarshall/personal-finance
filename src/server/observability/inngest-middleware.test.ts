import {
	context,
	propagation,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import {
	CompositePropagator,
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { BaggageKey, setBaggage } from "./baggage";
import { TracingMiddleware } from "./inngest-middleware";
import { captureTraceCarrier } from "./trace-carrier";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() =>
	provider.register({
		propagator: new CompositePropagator({
			propagators: [
				new W3CTraceContextPropagator(),
				new W3CBaggagePropagator(),
			],
		}),
	}),
);
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());
// Restore any global spy (e.g. process.stdout.write) even if a test throws
// before its own mockRestore — a leaked stdout mock corrupts sibling tests.
afterEach(() => vi.restoreAllMocks());

const tracer = provider.getTracer("test");

function buildMw() {
	return new TracingMiddleware({ client: {} as never });
}

function buildCtx(opts?: {
	data?: Record<string, unknown>;
	id?: string;
	name?: string;
	runId?: string;
	attempt?: number;
}) {
	return {
		event: {
			id: opts?.id ?? "evt-1",
			name: opts?.name ?? "receipt/process",
			data: opts?.data ?? {},
			ts: Date.now(),
		},
		runId: opts?.runId ?? "run-1",
		attempt: opts?.attempt ?? 0,
	};
}

function buildFn(id = "process-receipt") {
	return { id: () => id };
}

describe("TracingMiddleware.wrapFunctionHandler", () => {
	it("span shares producer traceId and carries one link to the producer span", async () => {
		const producerSpan = tracer.startSpan("producer");
		const producerTraceId = producerSpan.spanContext().traceId;
		const carrier = context.with(
			setBaggage(
				{ [BaggageKey.MemberId]: "m1" },
				trace.setSpan(context.active(), producerSpan),
			),
			() => captureTraceCarrier(),
		);
		producerSpan.end();

		const mw = buildMw();
		const ctx = buildCtx({ data: { _trace: carrier, receiptId: 42 } });
		const next = vi.fn(async () => {});

		await mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never);

		const fnSpan = exporter
			.getFinishedSpans()
			.find((s) => s.name === "inngest.function.process-receipt");
		expect(fnSpan).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.spanContext().traceId).toBe(producerTraceId);
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.links).toHaveLength(1);
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.links[0]!.context.traceId).toBe(producerTraceId);
	});

	it("next() runs with inngest baggage and the producer's member.id", async () => {
		const producerSpan = tracer.startSpan("producer");
		const carrier = context.with(
			setBaggage(
				{ [BaggageKey.MemberId]: "m1" },
				trace.setSpan(context.active(), producerSpan),
			),
			() => captureTraceCarrier(),
		);
		producerSpan.end();

		const mw = buildMw();
		const ctx = buildCtx({
			data: { _trace: carrier, receiptId: 42 },
			id: "evt-x",
			runId: "run-x",
			attempt: 1,
		});

		let capturedBag: Record<string, string | undefined>;
		const next = vi.fn(async () => {
			const bag = propagation.getBaggage(context.active());
			capturedBag = {
				"inngest.run_id": bag?.getEntry("inngest.run_id")?.value,
				"inngest.attempt": bag?.getEntry("inngest.attempt")?.value,
				"outbox.event_id": bag?.getEntry("outbox.event_id")?.value,
				"receipt.id": bag?.getEntry("receipt.id")?.value,
				"member.id": bag?.getEntry("member.id")?.value,
			};
		});

		await mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never);

		// biome-ignore lint/style/noNonNullAssertion: assigned inside next() which ran.
		expect(capturedBag!["inngest.run_id"]).toBe("run-x");
		// biome-ignore lint/style/noNonNullAssertion: assigned inside next() which ran.
		expect(capturedBag!["inngest.attempt"]).toBe("1");
		// biome-ignore lint/style/noNonNullAssertion: assigned inside next() which ran.
		expect(capturedBag!["outbox.event_id"]).toBe("evt-x");
		// biome-ignore lint/style/noNonNullAssertion: assigned inside next() which ran.
		expect(capturedBag!["receipt.id"]).toBe("42");
		// biome-ignore lint/style/noNonNullAssertion: assigned inside next() which ran.
		expect(capturedBag!["member.id"]).toBe("m1");
	});

	// A cron's event id is Inngest's own; labelling it an outbox row id misleads a join.
	it("omits outbox.event_id for a cron run (inngest/* event)", async () => {
		const ctx = buildCtx({ name: "inngest/scheduled.timer", id: "cron-evt" });

		let eventId: string | undefined = "unset";
		const next = vi.fn(async () => {
			eventId = propagation
				.getBaggage(context.active())
				?.getEntry("outbox.event_id")?.value;
		});

		await buildMw().wrapFunctionHandler({
			ctx,
			fn: buildFn("outbox-sweep"),
			next,
		} as never);

		expect(next).toHaveBeenCalled();
		expect(eventId).toBeUndefined();
	});

	it("event data is unchanged — _trace pocket is not removed", async () => {
		const producerSpan = tracer.startSpan("producer");
		const carrier = context.with(
			trace.setSpan(context.active(), producerSpan),
			() => captureTraceCarrier(),
		);
		producerSpan.end();

		const mw = buildMw();
		const data = { _trace: carrier, receiptId: 99 };
		const ctx = buildCtx({ data });

		let seenData: unknown;
		const next = vi.fn(async () => {
			seenData = ctx.event.data;
		});

		await mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never);
		expect(seenData).toEqual(data);
	});

	it("missing _trace → new root span, warn with event.name=trace.carrier.missing, next ran", async () => {
		const lines: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				if (typeof chunk === "string") lines.push(chunk);
				return true;
			});

		const mw = buildMw();
		const ctx = buildCtx({ data: {} });
		const next = vi.fn(async () => {});

		await mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never);
		spy.mockRestore();

		expect(next).toHaveBeenCalledOnce();

		const warnLine = lines.find((l) => {
			try {
				const p = JSON.parse(l);
				return (
					p.level === "warn" && p["event.name"] === "trace.carrier.missing"
				);
			} catch {
				return false;
			}
		});
		expect(warnLine).toBeDefined();

		const fnSpan = exporter
			.getFinishedSpans()
			.find((s) => s.name === "inngest.function.process-receipt");
		expect(fnSpan).toBeDefined();
		// A root span has no parent — the SDK leaves the parent field empty.
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.parentSpanContext).toBeUndefined();
		// The warn must sit on the exported function span, not on whatever span
		// Inngest had active around the handler (dropped by the sampler).
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		const warn = JSON.parse(warnLine!) as {
			trace_id?: string;
			span_id?: string;
		};
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(warn.trace_id).toBe(fnSpan!.spanContext().traceId);
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(warn.span_id).toBe(fnSpan!.spanContext().spanId);
	});

	it("malformed _trace → same as missing: warn log, new root span", async () => {
		const lines: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				if (typeof chunk === "string") lines.push(chunk);
				return true;
			});

		const mw = buildMw();
		const ctx = buildCtx({ data: { _trace: { traceparent: "garbage" } } });
		const next = vi.fn(async () => {});

		await mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never);
		spy.mockRestore();

		const warnLine = lines.find((l) => {
			try {
				const p = JSON.parse(l);
				return (
					p.level === "warn" && p["event.name"] === "trace.carrier.missing"
				);
			} catch {
				return false;
			}
		});
		expect(warnLine).toBeDefined();
	});

	it("cron run (inngest/* event) with no _trace → root span, no warn", async () => {
		const lines: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				if (typeof chunk === "string") lines.push(chunk);
				return true;
			});

		const mw = buildMw();
		const ctx = buildCtx({ data: {}, name: "inngest/scheduled.timer" });
		const next = vi.fn(async () => {});

		try {
			await mw.wrapFunctionHandler({
				ctx,
				fn: buildFn("outbox-sweep"),
				next,
			} as never);
		} finally {
			spy.mockRestore();
		}

		const warnLine = lines.find((l) => {
			try {
				return JSON.parse(l)["event.name"] === "trace.carrier.missing";
			} catch {
				return false;
			}
		});
		expect(warnLine).toBeUndefined();

		const fnSpan = exporter
			.getFinishedSpans()
			.find((s) => s.name === "inngest.function.outbox-sweep");
		expect(fnSpan).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.parentSpanContext).toBeUndefined();
	});

	it("next throws → span status ERROR, exception recorded, error rethrown", async () => {
		const producerSpan = tracer.startSpan("producer");
		const carrier = context.with(
			trace.setSpan(context.active(), producerSpan),
			() => captureTraceCarrier(),
		);
		producerSpan.end();

		const mw = buildMw();
		const ctx = buildCtx({ data: { _trace: carrier } });
		const thrown = new Error("boom");
		const next = vi.fn(async () => {
			throw thrown;
		});

		await expect(
			mw.wrapFunctionHandler({ ctx, fn: buildFn(), next } as never),
		).rejects.toThrow("boom");

		const fnSpan = exporter
			.getFinishedSpans()
			.find((s) => s.name === "inngest.function.process-receipt");
		expect(fnSpan).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.status.code).toBe(SpanStatusCode.ERROR);
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(fnSpan!.events.some((e) => e.name === "exception")).toBe(true);
	});
});

describe("TracingMiddleware.onRunError", () => {
	it("logs error line with inngest attrs, isFinalAttempt, and receipt.id", async () => {
		const lines: string[] = [];
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk) => {
				if (typeof chunk === "string") lines.push(chunk);
				return true;
			});

		const mw = buildMw();
		const ctx = buildCtx({
			data: { receiptId: 5 },
			runId: "run-err",
			attempt: 2,
		});
		const error = new Error("extraction failed");

		await mw.onRunError({
			ctx,
			error,
			fn: buildFn(),
			isFinalAttempt: true,
		} as never);

		spy.mockRestore();

		const errorLine = lines.find((l) => {
			try {
				const p = JSON.parse(l);
				return p.level === "error" && p.msg === "inngest run failed";
			} catch {
				return false;
			}
		});
		expect(errorLine).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		const parsed = JSON.parse(errorLine!);
		expect(parsed["inngest.function_id"]).toBe("process-receipt");
		expect(parsed["inngest.run_id"]).toBe("run-err");
		expect(parsed["inngest.attempt"]).toBe("2");
		expect(parsed.isFinalAttempt).toBe(true);
		expect(parsed["receipt.id"]).toBe("5");
	});

	it("warns, not errors, on a non-final attempt — a retry may still succeed", async () => {
		const lines: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		});

		await buildMw().onRunError({
			ctx: buildCtx({ attempt: 0 }),
			error: new Error("transient"),
			fn: buildFn(),
			isFinalAttempt: false,
		} as never);

		const parsed = lines.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
		expect(parsed.some((p) => p.level === "error")).toBe(false);
		expect(
			parsed.some(
				(p) => p.level === "warn" && p.msg === "inngest attempt failed",
			),
		).toBe(true);
	});

	it("re-attaches the carrier — error line carries the producer trace_id", async () => {
		const producerSpan = tracer.startSpan("producer");
		const producerTraceId = producerSpan.spanContext().traceId;
		const carrier = context.with(
			trace.setSpan(context.active(), producerSpan),
			() => captureTraceCarrier(),
		);
		producerSpan.end();

		const lines: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		});

		const mw = buildMw();
		const ctx = buildCtx({ data: { _trace: carrier } });

		await mw.onRunError({
			ctx,
			error: new Error("boom"),
			fn: buildFn(),
			isFinalAttempt: true,
		} as never);

		const errorLine = lines.find((l) => {
			try {
				const p = JSON.parse(l);
				return p.level === "error" && p.msg === "inngest run failed";
			} catch {
				return false;
			}
		});
		expect(errorLine).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
		expect(JSON.parse(errorLine!).trace_id).toBe(producerTraceId);
	});
});
