import { AlertCircle, CheckCircle2, Clock, TimerOff } from "lucide-react";
import type { ComponentType } from "react";
import { Spinner } from "~/components/ui/spinner";
import type { LatestImport } from "~/domain/cdr";
import { cn } from "~/lib/utils";
import {
	type ImportPhase,
	importCountLabels,
	importPhase,
	importRangeLabel,
	importStatusLabel,
} from "./import.display";

const PHASE_LOOK: Record<
	ImportPhase,
	{
		tone: string;
		Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
	}
> = {
	waiting: { tone: "text-foreground", Icon: Clock },
	importing: { tone: "text-foreground", Icon: Spinner },
	stalled: { tone: "text-muted-foreground", Icon: TimerOff },
	done: { tone: "text-positive", Icon: CheckCircle2 },
	failed: { tone: "text-destructive", Icon: AlertCircle },
};

// The server saw no failure, so there's no reason to show; say what to do instead.
const STALLED_NEXT = "Run the same range again to bring in the rest.";

/** Polling lives in the view, not here. */
export function ImportStatus({ latest }: { latest: LatestImport | null }) {
	return (
		<div>
			{/* Always mounted, so each status change is read out once. Counts stay out: they tick every poll. */}
			<p className="sr-only" role="status">
				{latest ? statusAnnouncement(latest) : ""}
			</p>
			{latest ? (
				<RunStatus run={latest} />
			) : (
				<p className="text-sm text-muted-foreground">
					No imports yet. Pick a range to bring in older history.
				</p>
			)}
		</div>
	);
}

function RunStatus({ run }: { run: LatestImport }) {
	const phase = importPhase(run);
	const { tone, Icon } = PHASE_LOOK[phase];
	const counted = [run.added, run.adopted, run.flagged, run.known].some(
		(count) => count !== 0,
	);
	// A stopped run that counted nothing would only show a row of zeros.
	const showCounts =
		phase === "importing" ||
		phase === "done" ||
		(phase !== "waiting" && counted);
	return (
		<div className="space-y-2">
			<p className={cn("flex items-center gap-1.5 text-sm font-medium", tone)}>
				<Icon aria-hidden className="size-4" />
				{importStatusLabel(run)}
			</p>
			<p className="tabular text-sm text-muted-foreground">
				{importRangeLabel(run)}
			</p>
			{showCounts && (
				<p className="tabular flex flex-wrap gap-x-1.5 text-sm text-foreground">
					{importCountLabels(run).map((count, index, counts) => (
						// The dot trails, so a wrapped line never starts with one.
						<span className="whitespace-nowrap" key={count}>
							{count}
							{index < counts.length - 1 && <span aria-hidden="true"> ·</span>}
						</span>
					))}
				</p>
			)}
			{run.error && (
				<p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-foreground">
					{run.error}
				</p>
			)}
			{phase === "stalled" && (
				<p className="text-sm text-muted-foreground">{STALLED_NEXT}</p>
			)}
		</div>
	);
}

function statusAnnouncement(run: LatestImport): string {
	const status = `Import status: ${importStatusLabel(run)}.`;
	const next =
		run.error ?? (importPhase(run) === "stalled" ? STALLED_NEXT : null);
	return next ? `${status} ${next}` : status;
}
