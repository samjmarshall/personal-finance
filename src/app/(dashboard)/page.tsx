import { AsyncBoundary } from "~/components/async-boundary";
import { PageHeader } from "~/components/page-header";
import {
	CashFlowSection,
	CashFlowSectionSkeleton,
} from "./_components/cash-flow-section";
import { SpendCharts, SpendChartsSkeleton } from "./_components/spend-charts";
import { StatCards, StatCardsSkeleton } from "./_components/stat-cards";

// Sync on purpose: the header paints at once and each section streams in on its
// own. Sections start their calls together, not one after another.
export default function DashboardPage() {
	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				description="A snapshot of your household budget and spending."
				title="Overview"
			/>

			{/* Spacing sits outside each boundary, so the skeleton, content and
			    error card all keep the same gap. */}
			<div className="mt-6">
				<AsyncBoundary label="summary" skeleton={<StatCardsSkeleton />}>
					<StatCards />
				</AsyncBoundary>
			</div>

			<div className="mt-4">
				<AsyncBoundary label="cash flow" skeleton={<CashFlowSectionSkeleton />}>
					<CashFlowSection />
				</AsyncBoundary>
			</div>

			<div className="mt-4">
				<AsyncBoundary label="spending" skeleton={<SpendChartsSkeleton />}>
					<SpendCharts />
				</AsyncBoundary>
			</div>
		</div>
	);
}
