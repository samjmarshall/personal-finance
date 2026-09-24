import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import {
	type Sampler,
	SamplingDecision,
	type SamplingResult,
} from "@opentelemetry/sdk-trace-base";

// Inngest's SDK starts its own `inngest.execution` root per execution request
// (adr016 §6). Our `inngest.function.*` span parents onto the outbox pocket, not
// onto it, so dropping the name loses nothing of ours.
export const DROPPED_SPAN_NAMES: ReadonlySet<string> = new Set([
	"inngest.execution",
]);

interface NameDropSamplerDeps {
	inner: Sampler;
	dropNames: ReadonlySet<string>;
}

// NOT_RECORD for an exact-name match, otherwise the inner sampler's call. With a
// parent-based inner, whatever the SDK parents onto a dropped span is dropped too.
export class NameDropSampler implements Sampler {
	private readonly inner: Sampler;
	private readonly dropNames: ReadonlySet<string>;

	constructor(deps: NameDropSamplerDeps) {
		this.inner = deps.inner;
		this.dropNames = deps.dropNames;
	}

	shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		if (this.dropNames.has(spanName)) {
			return { decision: SamplingDecision.NOT_RECORD };
		}
		return this.inner.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);
	}

	toString(): string {
		return `NameDropSampler{${[...this.dropNames].join(",")}} → ${this.inner.toString()}`;
	}
}
