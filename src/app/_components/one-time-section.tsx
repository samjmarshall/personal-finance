"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Money } from "~/app/_components/money";
import { Card } from "~/components/ui/card";
import { cn, isPast } from "~/lib/utils";

// Shared "One-time" surface for the Planned expenses and income views: the card
// chrome, the upcoming/past partition, and the collapsible past group. Callers own
// the row columns (via renderRow + columnHeader) since expenses adds consumed/
// remaining. State (past collapse) stays local to this component that owns it —
// a presentational component, not a reusable hook or context (adr001).
type OneTimeSectionProps<T extends { id: number }> = {
	// Already filtered to one-time rows; the section self-hides when empty.
	items: T[];
	getExpectedDate: (item: T) => Date | null;
	getAmount: (item: T) => number | null;
	// <Money> tone for the header total (income is always green; expenses default).
	totalTone?: "income";
	// Namespaces the past group's aria ids, e.g. "expense" | "income".
	idPrefix: string;
	// The hidden sm:grid header labels — must match renderRow's column template.
	columnHeader: React.ReactNode;
	renderRow: (item: T) => React.ReactNode;
};

export function OneTimeSection<T extends { id: number }>({
	items,
	getExpectedDate,
	getAmount,
	totalTone,
	idPrefix,
	columnHeader,
	renderRow,
}: OneTimeSectionProps<T>) {
	// Past group starts collapsed — bygone one-times are the least relevant.
	const [pastOpen, setPastOpen] = useState(false);

	if (items.length === 0) return null;

	// Partition on each render (not a [items]-keyed memo) with a fresh now, so an
	// item that becomes past — e.g. the page sat open across midnight — re-classifies
	// on any re-render without waiting for the data to change. The list is tiny.
	const now = new Date();
	const upcoming: T[] = [];
	const past: T[] = [];
	for (const item of items) {
		const date = getExpectedDate(item);
		if (date && isPast(date, now)) past.push(item);
		else upcoming.push(item);
	}
	const byDate = (a: T, b: T) =>
		(getExpectedDate(a)?.getTime() ?? 0) - (getExpectedDate(b)?.getTime() ?? 0);
	upcoming.sort(byDate); // soonest first
	past.sort((a, b) => byDate(b, a)); // most recent first
	const total = items.reduce((s, item) => s + (getAmount(item) ?? 0), 0);

	const pastId = `${idPrefix}-onetime-past`;
	return (
		<Card className="[--card-spacing:0px]">
			<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3">
				<span className="flex items-center gap-2">
					<span className="font-semibold text-foreground text-sm">
						One-time
					</span>
					<span className="text-muted-foreground text-xs">
						({items.length})
					</span>
				</span>
				<span className="text-muted-foreground text-xs">
					<Money className="font-medium" tone={totalTone} value={total} /> total
				</span>
			</div>
			<div className="divide-y divide-border">
				{columnHeader}
				{upcoming.map(renderRow)}
				{past.length > 0 && (
					<div>
						<button
							aria-controls={pastId}
							aria-expanded={pastOpen}
							className="flex w-full items-center gap-2 px-4 py-2 text-left text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setPastOpen((v) => !v)}
							type="button"
						>
							<ChevronDown
								className={cn(
									"h-3.5 w-3.5 shrink-0 transition-transform",
									!pastOpen && "-rotate-90",
								)}
							/>
							Past ({past.length})
						</button>
						<div
							className="divide-y divide-border border-border border-t"
							hidden={!pastOpen}
							id={pastId}
						>
							{past.map(renderRow)}
						</div>
					</div>
				)}
			</div>
		</Card>
	);
}
