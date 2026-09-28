// The PostHog UI config the deep-link needs — the env pair that always travels
// together. projectId optional: unset in envs with no PostHog project (no link).
export interface PosthogUiConfig {
	uiHost: string;
	projectId?: string;
}

// Server-built deep-link into the PostHog trace viewer for a receipt's ingest run.
// Null (no link) when either the project or the trace id is absent. Built through
// `URL` so a trailing slash on the host can't double up (`//project`) and the ids
// are percent-encoded — we don't validate them, a bad id still fails in PostHog.
export function posthogTraceUrl(
	config: PosthogUiConfig,
	traceId: string | null,
): string | null {
	if (!config.projectId || !traceId) return null;
	const url = new URL(
		`/project/${encodeURIComponent(config.projectId)}/tracing`,
		config.uiHost,
	);
	url.searchParams.set("trace", traceId);
	return url.toString();
}
