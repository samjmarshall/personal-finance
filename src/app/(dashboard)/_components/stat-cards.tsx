import { ArrowUpRight, Receipt, Scale, Wallet } from "lucide-react";

import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { CommitmentKind } from "~/lib/constants";
import { cn, formatCurrency } from "~/lib/utils";
import { getExpenses, getIncome, getSummary } from "./overview-data";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4";

export async function StatCards() {
	const [summary, expenses, income] = await Promise.all([
		getSummary(),
		getExpenses(),
		getIncome(),
	]);

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
		<div className={GRID}>
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
							<p className="mt-1 text-muted-foreground text-xs">{stat.hint}</p>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

export function StatCardsSkeleton() {
	return (
		<div aria-hidden className={GRID}>
			{[0, 1, 2, 3].map((i) => (
				<Card key={i}>
					<CardContent>
						{/* Heights mirror the real card: label row 20, value 32, hint 16. */}
						<Skeleton className="h-5 w-32" />
						<Skeleton className="mt-3 h-8 w-28" />
						<Skeleton className="mt-1 h-4 w-24" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}
