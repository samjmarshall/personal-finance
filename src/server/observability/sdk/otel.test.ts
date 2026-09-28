import type { Configuration } from "@vercel/otel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	POSTHOG_KEY: undefined as string | undefined,
	POSTHOG_HOST: "https://us.i.posthog.com",
	PROJECT_NAME: "personal-finance",
	BEDROCK_INPUT_TOKEN_PRICE_USD: 0,
	BEDROCK_OUTPUT_TOKEN_PRICE_USD: 0,
}));
vi.mock("~/env", () => ({ env }));
vi.mock("@vercel/otel", () => ({ registerOTel: vi.fn() }));
vi.mock("ai", () => ({ registerTelemetry: vi.fn() }));
// Never "already booted", so each test runs the full boot.
vi.mock("./otel-registry", () => ({
	getRegisteredProcessors: () => null,
	setRegisteredProcessors: vi.fn(),
}));

const { registerOTel } = await import("@vercel/otel");
const { registerObservability } = await import("./otel");

function bootedFetchConfig() {
	env.POSTHOG_KEY = "phc_test";
	registerObservability();
	const [opts] = vi.mocked(registerOTel).mock.calls[0] as [Configuration];
	return opts.instrumentationConfig?.fetch ?? {};
}

function ignored(url: string, patterns: (string | RegExp)[]): boolean {
	return patterns.some((p) =>
		typeof p === "string" ? url.startsWith(p) : p.test(url),
	);
}

beforeEach(() => {
	vi.mocked(registerOTel).mockClear();
	env.POSTHOG_KEY = undefined;
});

describe("registerObservability", () => {
	it("registers nothing without a PostHog key", () => {
		registerObservability();

		expect(registerOTel).not.toHaveBeenCalled();
	});

	// Trace ids + baggage must not leak to third parties (Bedrock, Resend).
	it("adds no outbound hosts that receive trace context", () => {
		expect(bootedFetchConfig().propagateContextUrls).toEqual([]);
	});

	// The event key sits in the send URL path; a traced send ships it to PostHog.
	it.each([
		"https://inn.gs/e/KEY",
		"https://inngest.personal-finance.localhost/e/KEY",
		"http://localhost:8288/e/KEY",
		"http://127.0.0.1:8288/e/KEY",
		"https://events.example.com/e/KEY",
	])("keeps the Inngest send %s out of traces", (url) => {
		expect(ignored(url, bootedFetchConfig().ignoreUrls ?? [])).toBe(true);
	});

	it("still traces other outbound calls", () => {
		const url = "https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/x";

		expect(ignored(url, bootedFetchConfig().ignoreUrls ?? [])).toBe(false);
	});
});
