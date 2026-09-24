import { ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import {
	AlwaysOnSampler,
	InMemorySpanExporter,
	ParentBasedSampler,
	type Sampler,
	SamplingDecision,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { DROPPED_SPAN_NAMES, NameDropSampler } from "./sampler";

function recordingInner() {
	const calls: string[] = [];
	const inner: Sampler = {
		shouldSample: (_ctx, _traceId, name) => {
			calls.push(name);
			return { decision: SamplingDecision.RECORD_AND_SAMPLED };
		},
		toString: () => "inner",
	};
	return { inner, calls };
}

describe("NameDropSampler", () => {
	it("returns NOT_RECORD for a dropped name without consulting the inner sampler", () => {
		const { inner, calls } = recordingInner();
		const sampler = new NameDropSampler({
			inner,
			dropNames: new Set(["inngest.execution"]),
		});

		const result = sampler.shouldSample(
			ROOT_CONTEXT,
			"t",
			"inngest.execution",
			SpanKind.INTERNAL,
			{},
			[],
		);

		expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
		expect(calls).toEqual([]);
	});

	it("delegates every other name to the inner sampler", () => {
		const { inner, calls } = recordingInner();
		const sampler = new NameDropSampler({
			inner,
			dropNames: new Set(["inngest.execution"]),
		});

		const result = sampler.shouldSample(
			ROOT_CONTEXT,
			"t",
			"inngest.function.process-receipt",
			SpanKind.INTERNAL,
			{},
			[],
		);

		expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
		expect(calls).toEqual(["inngest.function.process-receipt"]);
		expect(sampler.toString()).toBe(
			"NameDropSampler{inngest.execution} → inner",
		);
	});

	// The otel.ts composition: the drop sits in front of parent-based always-on, so
	// Inngest's root goes, anything the SDK parents onto it goes, and ours — which
	// parents onto the outbox pocket, never onto inngest.execution — records.
	it("composed with parent-based always-on, drops Inngest's root and its children but keeps our function span", async () => {
		const exporter = new InMemorySpanExporter();
		const provider = new NodeTracerProvider({
			sampler: new NameDropSampler({
				inner: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
				dropNames: DROPPED_SPAN_NAMES,
			}),
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		const tracer = provider.getTracer("test");

		try {
			const execution = tracer.startSpan("inngest.execution");
			const sdkChild = tracer.startSpan(
				"inngest.step",
				{},
				trace.setSpan(ROOT_CONTEXT, execution),
			);
			sdkChild.end();
			execution.end();
			const ours = tracer.startSpan("inngest.function.process-receipt");
			ours.end();

			expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
				"inngest.function.process-receipt",
			]);
		} finally {
			await provider.shutdown();
		}
	});
});
