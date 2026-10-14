"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { AsyncBoundary, LoadingRegion } from "~/components/async-boundary";
import { PageHeader } from "~/components/page-header";
import { UnplannedGroupsSkeleton } from "~/components/route-skeletons";
import { Button } from "~/components/ui/button";
import {
	fortnightWindow,
	monthWindow,
	type PeriodKind,
	type PeriodWindow,
	shiftWindow,
} from "~/lib/period";
import { formatDate, fromDateInput } from "~/lib/utils";
import { api } from "~/trpc/react";
import { UnplannedTable } from "./unplanned-table";

const monthLabelFormatter = new Intl.DateTimeFormat("en-AU", {
	month: "long",
	year: "numeric",
});

function periodLabel(kind: PeriodKind, range: PeriodWindow): string {
	if (kind === "month") return monthLabelFormatter.format(range.from);
	// Window is half-open [from, to); show the inclusive last day.
	const last = new Date(range.to);
	last.setDate(last.getDate() - 1);
	return `${formatDate(range.from)} – ${formatDate(last)}`;
}

export function UnplannedView() {
	const [anchor] = api.setting.fortnightAnchor.useSuspenseQuery();

	// Memoised so it's a stable effect dependency (fromDateInput mints a fresh
	// Date each call) and parsed once, not again in the seed effect below.
	const anchorDate = useMemo(
		() => (anchor ? fromDateInput(anchor) : null),
		[anchor],
	);

	// Fortnight needs the anchor to seed its grid; without one the picker is
	// month-only (design: degrade, never error).
	const [kind, setKind] = useState<PeriodKind>(
		anchorDate ? "fortnight" : "month",
	);
	// Defer to effect: new Date() is UTC on the server but local-tz in the browser,
	// so seeding during render causes a hydration mismatch at day boundaries.
	// kind is co-seeded here so it can't desync from the window if the anchor
	// arrives after mount.
	const [range, setRange] = useState<PeriodWindow | null>(null);
	// The anchor the window was seeded from (undefined: not yet). Leaving the
	// route hides this view (Activity), and a return re-runs the effect; without
	// this it would snap the member's stepped period back to today's.
	const seededFor = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (seededFor.current === anchor) return;
		seededFor.current = anchor;
		const now = new Date();
		setKind(anchorDate ? "fortnight" : "month");
		setRange(anchorDate ? fortnightWindow(anchorDate, now) : monthWindow(now));
	}, [anchor, anchorDate]);

	// The table keeps the old period's rows (dimmed) while the new ones load,
	// instead of suspending back to its skeleton.
	const deferredRange = useDeferredValue(range);

	function selectKind(next: PeriodKind) {
		// Re-clicking the active length would reset the window back to today,
		// discarding the user's prev/next navigation — only act on a real change.
		if (next === kind) return;
		setKind(next);
		setRange(
			next === "fortnight" && anchorDate
				? fortnightWindow(anchorDate, new Date())
				: monthWindow(new Date()),
		);
	}

	function step(direction: 1 | -1) {
		setRange((r) => (r ? shiftWindow(r, kind, direction) : r));
	}

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="Spend not yet linked to a planned expense. Link a transaction to move it out of here."
				title="Unplanned"
			/>

			<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<Button
						aria-label="Previous period"
						disabled={!range}
						onClick={() => step(-1)}
						size="icon-sm"
						variant="outline"
					>
						<ChevronLeft />
					</Button>
					<span
						aria-atomic="true"
						aria-live="polite"
						className="tabular min-w-44 text-center font-medium text-foreground text-sm"
					>
						{range ? periodLabel(kind, range) : "…"}
					</span>
					<Button
						aria-label="Next period"
						disabled={!range}
						onClick={() => step(1)}
						size="icon-sm"
						variant="outline"
					>
						<ChevronRight />
					</Button>
				</div>
				{anchorDate && (
					<fieldset className="flex gap-1">
						<legend className="sr-only">Period length</legend>
						{(["fortnight", "month"] as const).map((k) => (
							<Button
								aria-pressed={kind === k}
								key={k}
								onClick={() => selectKind(k)}
								size="sm"
								variant={kind === k ? "secondary" : "ghost"}
							>
								{k === "fortnight" ? "Fortnight" : "Month"}
							</Button>
						))}
					</fieldset>
				)}
			</div>

			<div className="mt-6">
				{/* The lagging copy, not the live one: it's still empty for one
				    render after the period is first set. */}
				{deferredRange === null ? (
					<LoadingRegion
						label="unplanned Spend"
						skeleton={<UnplannedGroupsSkeleton />}
					/>
				) : (
					// Its own boundary, so the rows' first load doesn't suspend the
					// whole page back to its skeleton.
					<AsyncBoundary
						fade={false}
						label="unplanned Spend"
						resetKey={deferredRange}
						skeleton={<UnplannedGroupsSkeleton />}
					>
						<UnplannedTable
							range={deferredRange}
							stale={range !== deferredRange}
						/>
					</AsyncBoundary>
				)}
			</div>
		</div>
	);
}
