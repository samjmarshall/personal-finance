// Server-built deep-link into the PostHog trace viewer for a receipt's ingest run.
// Null (no link) when either the project or the trace id is absent — the id is
// passed verbatim, never rewritten, so a bad id fails loudly in PostHog, not here.
export function posthogTraceUrl({
	uiHost,
	projectId,
	traceId,
}: {
	uiHost: string;
	projectId?: string;
	traceId: string | null;
}): string | null {
	if (!projectId || !traceId) return null;
	return `${uiHost}/project/${projectId}/tracing?trace=${traceId}`;
}
