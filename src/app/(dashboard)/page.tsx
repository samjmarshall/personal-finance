import {
	ArrowDownRight,
	ArrowUpRight,
	Receipt,
	Scale,
	Wallet,
} from "lucide-react";

import { PageHeader } from "~/app/_components/page-header";
import { MonthlySpendChart } from "~/app/_components/dashboard/monthly-spend-chart";
import { PriorityBreakdown } from "~/app/_components/dashboard/priority-breakdown";
import { TopCategories } from "~/app/_components/dashboard/top-categories";
import { Card } from "~/app/_components/ui/primitives";
import { Money } from "~/app/_components/ui/money";
import { cn, formatCurrency } from "~/lib/utils";
import { api } from "~/trpc/server";

export default async function DashboardPage() {
	const [summary, expenses, income] = await Promise.all([
		api.transaction.summary(),
		api.expense.list(),
		api.income.list(),
	]);

	const budgetedMonthly = expenses.reduce((sum, e) => sum + (e.month ?? 0), 0);
	const incomeMonthly = income.reduce((sum, i) => sum + (i.month ?? 0), 0);
	const leftover = incomeMonthly - budgetedMonthly;

	const stats = [
		{
			label: "Monthly income",
			value: formatCurrency(incomeMonthly),
			icon: ArrowUpRight,
			accent: "text-positive",
			hint: `${income.length} sources`,
		},
		{
			label: "Budgeted expenses",
			value: formatCurrency(budgetedMonthly),
			icon: Wallet,
			accent: "text-foreground",
			hint: `${expenses.length} line items / month`,
		},
		{
			label: "Projected leftover",
			value: formatCurrency(leftover),
			icon: Scale,
			accent: leftover >= 0 ? "text-positive" : "text-spend",
			hint: leftover >= 0 ? "Surplus" : "Shortfall",
		},
		{
			label: "Recorded spend",
			value: formatCurrency(summary.totals.spend),
			icon: Receipt,
			accent: "text-foreground",
			hint: `${summary.totals.count} transactions`,
		},
	];

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				title="Overview"
				description="A snapshot of your household budget and spending."
			/>

			<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{stats.map((stat) => {
					const Icon = stat.icon;
					return (
						<Card key={stat.label} className="p-5">
							<div className="flex items-center justify-between">
								<span className="text-sm font-medium text-muted-foreground">
									{stat.label}
								</span>
								<Icon className={cn("h-4 w-4", stat.accent)} />
							</div>
							<p
								className={cn(
									"mt-3 text-2xl font-semibold tracking-tight tabular",
									stat.accent,
								)}
							>
								{stat.value}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
						</Card>
					);
				})}
			</div>

			<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="p-5 lg:col-span-2">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<h2 className="text-sm font-semibold text-foreground">
								Monthly spend
							</h2>
							<p className="text-xs text-muted-foreground">
								Recorded outgoings by month
							</p>
						</div>
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<ArrowDownRight className="h-3.5 w-3.5 text-spend" />
							Net {" "}
							<Money value={summary.totals.net} className="font-medium" />
						</div>
					</div>
					<MonthlySpendChart data={summary.byMonth} />
				</Card>

				<Card className="p-5">
					<h2 className="text-sm font-semibold text-foreground">
						Spend by priority
					</h2>
					<p className="mb-4 text-xs text-muted-foreground">
						Where the money goes
					</p>
					<PriorityBreakdown
						data={summary.byPriority}
						total={summary.totals.spend}
					/>
				</Card>
			</div>

			<div className="mt-4">
				<Card className="p-5">
					<h2 className="text-sm font-semibold text-foreground">
						Top categories
					</h2>
					<p className="mb-4 text-xs text-muted-foreground">
						Largest recorded spend across all transactions
					</p>
					<TopCategories data={summary.topCategories} />
				</Card>
			</div>
		</div>
	);
}
