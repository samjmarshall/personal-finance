import {
	ArrowDownRight,
	ArrowUpRight,
	Receipt,
	Scale,
	Wallet,
} from "lucide-react";
import { Money } from "~/components/money";
import { PageHeader } from "~/components/page-header";
import { Card, CardContent } from "~/components/ui/card";
import { CommitmentKind } from "~/lib/constants";
import { cn, formatCurrency } from "~/lib/utils";
import { api, HydrateClient } from "~/trpc/server";
import { BalanceSnapshotCard } from "./_components/balance-snapshot-card";
import { CashFlowChart } from "./_components/cash-flow-chart";
import { MonthlySpendChart } from "./_components/monthly-spend-chart";
import { PriorityBreakdown } from "./_components/priority-breakdown";
import { TopGroups } from "./_components/top-groups";

export default async function DashboardPage() {
	const [summary, expenses, income] = await Promise.all([
		api.transaction.summary(),
		api.expense.list(),
		api.income.list(),
	]);

	// The cash-flow chart and balance card are client suspense components; prefetch
	// their queries here so they hydrate from the dehydrated cache, no client spinner.
	void api.cashflow.get.prefetch({ periodKind: "fortnight" });
	void api.balance.latest.prefetch();

	// Recurring-only: one-time rows carry a monthly cadence of 0, and every figure
	// here (counts + leftover) is monthly-framed, so one-time entries mustn't count.
	// Leftover stays recurring-monthly — upcoming one-time spend isn't a cadence.
	const recurringExpenses = expenses.filter(
		(e) => e.kind === CommitmentKind.Recurring,
	);
	const recurringIncome = income.filter(
		(i) => i.kind === CommitmentKind.Recurring,
	);
	const budgetedMonthly = recurringExpenses.reduce(
		(sum, e) => sum + (e.month ?? 0),
		0,
	);
	const incomeMonthly = recurringIncome.reduce(
		(sum, i) => sum + (i.month ?? 0),
		0,
	);
	const leftover = incomeMonthly - budgetedMonthly;

	const stats = [
		{
			label: "Monthly income",
			value: formatCurrency(incomeMonthly),
			icon: ArrowUpRight,
			accent: "text-positive",
			hint: `${recurringIncome.length} sources`,
		},
		{
			label: "Budgeted expenses",
			value: formatCurrency(budgetedMonthly),
			icon: Wallet,
			accent: "text-foreground",
			hint: `${recurringExpenses.length} line items / month`,
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
		<HydrateClient>
			<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
				<PageHeader
					description="A snapshot of your household budget and spending."
					title="Overview"
				/>

				<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
					{stats.map((stat) => {
						const Icon = stat.icon;
						return (
							<Card key={stat.label}>
								<CardContent>
									<div className="flex items-center justify-between">
										<span className="font-medium text-muted-foreground text-sm">
											{stat.label}
										</span>
										<Icon className={cn("h-4 w-4", stat.accent)} />
									</div>
									<p
										className={cn(
											"tabular mt-3 font-semibold text-2xl tracking-tight",
											stat.accent,
										)}
									>
										{stat.value}
									</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{stat.hint}
									</p>
								</CardContent>
							</Card>
						);
					})}
				</div>

				<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
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

				<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
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
									Net{" "}
									<Money className="font-medium" value={summary.totals.net} />
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
		</HydrateClient>
	);
}
