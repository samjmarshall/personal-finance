import { Card, CardContent } from "~/components/ui/card";
import { api, HydrateClient } from "~/trpc/server";
import {
	BalanceSnapshotCard,
	BalanceSnapshotCardSkeleton,
} from "./balance-snapshot-card";
import { CashFlowChart, CashFlowChartSkeleton } from "./cash-flow-chart";

const GRID = "grid grid-cols-1 gap-4 lg:grid-cols-3";

export function CashFlowSection() {
	// The cash-flow chart and balance card are client suspense components; prefetch
	// their queries here so they hydrate from the dehydrated cache, no client spinner.
	void api.cashflow.get.prefetch({ periodKind: "fortnight" });
	void api.balance.latest.prefetch();

	return (
		<HydrateClient>
			<div className={GRID}>
				<Card className="overflow-visible lg:col-span-2">
					<CardContent>
						<CashFlowChart />
					</CardContent>
				</Card>
				<Card>
					<CardContent>
						<BalanceSnapshotCard />
					</CardContent>
				</Card>
			</div>
		</HydrateClient>
	);
}

export function CashFlowSectionSkeleton() {
	return (
		<div aria-hidden className={GRID}>
			<Card className="lg:col-span-2">
				<CardContent>
					<CashFlowChartSkeleton />
				</CardContent>
			</Card>
			<Card>
				<CardContent>
					<BalanceSnapshotCardSkeleton />
				</CardContent>
			</Card>
		</div>
	);
}
