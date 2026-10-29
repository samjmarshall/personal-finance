import { AlertCircle, CheckCircle2, Clock, TimerOff } from "lucide-react";
import { Spinner } from "~/components/ui/spinner";
import type { LatestImport } from "~/domain/cdr";
import { CdrImportStatus } from "~/lib/constants";
import { cn } from "~/lib/utils";
import { importCounts, importRange, importStatusLabel } from "./import.display";

/** The latest import, or a note that there's none. Polling lives with the view. */
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
	const label = importStatusLabel(run);
	const counted = [run.added, run.adopted, run.flagged, run.known].some(
		(count) => count !== 0,
	);
	// A stopped run that counted nothing would only show a row of zeros.
	const showCounts = run.active
		? run.status === CdrImportStatus.Running
		: run.status === CdrImportStatus.Done || counted;
	return (
		<div className="space-y-2">
			<p
				className={cn(
					"flex items-center gap-1.5 text-sm font-medium",
					run.status === CdrImportStatus.Failed
						? "text-destructive"
						: run.status === CdrImportStatus.Done
							? "text-positive"
							: run.active
								? "text-foreground"
								: "text-muted-foreground",
				)}
			>
				<StatusIcon run={run} />
				{label}
			</p>
			<p className="tabular text-sm text-muted-foreground">
				{importRange(run)}
			</p>
			{showCounts && (
				<p className="tabular flex flex-wrap gap-x-1.5 text-sm text-foreground">
					{importCounts(run).map((count, index) => (
						// Each count wraps whole, never mid-label.
						<span className="whitespace-nowrap" key={count}>
							{index > 0 && <span aria-hidden="true">· </span>}
							{count}
						</span>
					))}
				</p>
			)}
			{run.error && (
				<p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{run.error}
				</p>
			)}
		</div>
	);
}

function statusAnnouncement(run: LatestImport): string {
	const status = `Import status: ${importStatusLabel(run)}.`;
	return run.error ? `${status} ${run.error}` : status;
}

function StatusIcon({ run }: { run: LatestImport }) {
	if (run.active && run.status === CdrImportStatus.Running)
		return <Spinner className="size-4" />;
	if (run.active) return <Clock aria-hidden className="size-4" />;
	if (run.status === CdrImportStatus.Done)
		return <CheckCircle2 aria-hidden className="size-4" />;
	if (run.status === CdrImportStatus.Failed)
		return <AlertCircle aria-hidden className="size-4" />;
	return <TimerOff aria-hidden className="size-4" />;
}
