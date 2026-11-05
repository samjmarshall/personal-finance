import {
	CircleCheckIcon,
	OctagonXIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import Link from "next/link";
import {
	type ApplyOutcome,
	appliedLabel,
	applyProgressLabel,
	applyStoppedLabel,
} from "~/components/apply-progress.display";
import { Button, buttonVariants } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import type { CurrentApply } from "~/domain/transactions";
import { cn } from "~/lib/utils";

const ICONS = {
	running: Spinner,
	success: CircleCheckIcon,
	warning: TriangleAlertIcon,
	error: OctagonXIcon,
} as const;

/**
 * One Apply's toast. Props only: it renders inside `<Toaster />`, outside the
 * tRPC provider. Drawn to match sonner's own toasts, as a custom one gets no box.
 */
export function ApplyToast({
	apply,
	phase,
	onClose,
}: {
	apply: CurrentApply;
	phase: "running" | ApplyOutcome;
	onClose: () => void;
}) {
	const Icon = ICONS[phase];

	return (
		<div className="flex w-(--width) max-w-full items-start gap-2.5 rounded-lg border border-border bg-popover p-4 text-[13px] text-popover-foreground shadow-[0_4px_12px_rgb(0_0_0/0.1)]">
			<Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
			<div className="min-w-0 flex-1">
				{phase === "running" ? (
					<Progress apply={apply} />
				) : (
					<p className="leading-normal text-pretty">
						{phase === "error" ? applyStoppedLabel(apply) : appliedLabel(apply)}
					</p>
				)}
				{phase === "error" && (
					<Link
						className={cn(
							buttonVariants({ variant: "outline", size: "xs" }),
							"mt-2",
						)}
						href="/transactions/import"
					>
						Review
					</Link>
				)}
			</div>
			{/* Sonner draws no close button on a custom toast. */}
			<Button
				aria-label="Close"
				className="-mt-1 -mr-1.5 text-muted-foreground"
				onClick={onClose}
				size="icon-xs"
				variant="ghost"
			>
				<XIcon aria-hidden />
			</Button>
		</div>
	);
}

function Progress({ apply }: { apply: CurrentApply }) {
	const done = apply.total - apply.pending;
	const label = applyProgressLabel(apply);

	return (
		<>
			<p className="leading-normal font-medium">Applying answers</p>
			<div className="mt-2 flex items-center gap-3">
				<div
					aria-label="Applying answers"
					aria-valuemax={apply.total}
					aria-valuemin={0}
					aria-valuenow={done}
					aria-valuetext={label}
					className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
					role="progressbar"
				>
					<div
						className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
						style={{ width: `${(done / Math.max(apply.total, 1)) * 100}%` }}
					/>
				</div>
				{/* The toast region is polite: a visible count would be read out on every poll. */}
				<span
					aria-hidden="true"
					className="tabular shrink-0 text-xs text-muted-foreground"
				>
					{label}
				</span>
			</div>
		</>
	);
}
