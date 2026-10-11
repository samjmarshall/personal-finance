import { ArrowDownRight } from "lucide-react";

import { Money } from "~/components/money";
import { ChartSkeleton } from "~/components/skeletons";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { MonthlySpendChart } from "./monthly-spend-chart";
import { getSummary } from "./overview-data";
import { PriorityBreakdown } from "./priority-breakdown";
import { TopGroups } from "./top-groups";

const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-3";

export async function SpendCharts() {
	const summary = await getSummary();

	return (
		<div>
			<div className={GRID}>
				<Card className="overflow-visible lg:col-span-2">
					<CardContent>
						<div className="mb-4 flex items-center justify-between">
							<div>
								<h2 className="font-semibold text-foreground text-sm">
									Monthly spend
								</h2>
								<p className="text-muted-foreground text-xs">
									Recorded outgoings by month
								</p>
							</div>
							<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<ArrowDownRight className="h-3.5 w-3.5 text-spend" />
								Net <Money className="font-medium" value={summary.totals.net} />
							</div>
						</div>
						<MonthlySpendChart data={summary.byMonth} />
					</CardContent>
				</Card>

				<Card>
					<CardContent>
						<h2 className="font-semibold text-foreground text-sm">
							Spend by priority
						</h2>
						<p className="mb-4 text-muted-foreground text-xs">
							Where the money goes
						</p>
						<PriorityBreakdown
							data={summary.byPriority}
							total={summary.totals.spend}
						/>
					</CardContent>
				</Card>
			</div>

			<div className="mt-4">
				<Card>
					<CardContent>
						<h2 className="font-semibold text-foreground text-sm">
							Top groups
						</h2>
						<p className="mb-4 text-muted-foreground text-xs">
							Largest recorded spend across all transactions
						</p>
						<TopGroups data={summary.topGroups} />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

// Row counts match typical data (5 priorities, top 8 groups), so the swap
// shifts little. Empty data lands shorter.
export function SpendChartsSkeleton() {
	return (
		<div aria-hidden>
			<div className={GRID}>
				<Card className="lg:col-span-2">
					<CardContent>
						{/* Heading 36 + gap 16 + chart 224, as in the real card. */}
						<ChartSkeleton height={276} />
					</CardContent>
				</Card>
				<Card>
					<CardContent>
						<HeadingSkeleton />
						<div className="flex flex-col gap-4">
							{[0, 1, 2, 3, 4].map((i) => (
								<div className="flex flex-col gap-1.5" key={i}>
									<Skeleton className="h-5 w-2/3" />
									<Skeleton className="h-1.5 w-full" />
									<Skeleton className="h-4 w-24" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
			<div className="mt-4">
				<Card>
					<CardContent>
						<HeadingSkeleton />
						<div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
							{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
								<div className="flex flex-col gap-1.5" key={i}>
									<Skeleton className="h-5 w-2/3" />
									<Skeleton className="h-1.5 w-full" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

/** Title + subtitle lines, 36 + 16 gap like the real cards. */
function HeadingSkeleton() {
	return (
		<>
			<Skeleton className="my-0.5 h-4 w-32" />
			<Skeleton className="mt-0.5 mb-4.5 h-3 w-48" />
		</>
	);
}
