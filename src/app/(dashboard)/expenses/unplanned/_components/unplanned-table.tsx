"use client";

import { useMemo } from "react";

import { Money } from "~/components/money";
import { SelectField } from "~/components/select-field";
import { Card, CardContent } from "~/components/ui/card";
import type { PeriodWindow } from "~/lib/period";
import { cn, formatDate } from "~/lib/utils";
import { api } from "~/trpc/react";
import { groupByCategory } from "../../_components/group-by-category";

export function UnplannedTable({
	range,
	stale,
}: {
	range: PeriodWindow;
	/** A newer period's rows are loading; these are the old ones. */
	stale: boolean;
}) {
	const [expenses] = api.expense.list.useSuspenseQuery();
	const [categories] = api.category.list.useSuspenseQuery();
	const [rows] = api.transaction.unplanned.useSuspenseQuery({
		from: range.from,
		to: range.to,
	});

	const utils = api.useUtils();
	const link = api.transaction.linkExpense.useMutation({
		onSuccess: () => {
			// Linking moves the row into a planned Expense, so it leaves this
			// derived view and appears in the Planned transaction list.
			void utils.transaction.unplanned.invalidate();
			void utils.transaction.list.invalidate();
			// Row now counts toward that expense's used total on the Planned page.
			void utils.expense.consumption.invalidate();
		},
	});

	const expenseOptions = useMemo(
		() =>
			expenses.map((e) => ({
				value: String(e.id),
				label: e.name,
				// Long names truncate in the fixed-width picker; reveal on hover.
				title: e.name,
			})),
		[expenses],
	);

	const groups = useMemo(
		() => groupByCategory(rows, categories),
		[rows, categories],
	);

	return (
		<div
			aria-busy={stale}
			className={cn(
				"flex flex-col gap-6 transition-opacity",
				stale && "opacity-60",
			)}
		>
			{groups.length === 0 && (
				<Card
					className="text-center [--card-spacing:--spacing(10)]"
					role="status"
				>
					<CardContent>
						{/* Accurate whether the window holds no Spend at all or every
						    row is already linked — the query can't tell them apart. */}
						<p className="text-muted-foreground text-sm">
							No unplanned Spend in this period.
						</p>
					</CardContent>
				</Card>
			)}
			{groups.map(({ key, label, items: rowsInGroup }) => {
				const groupTotal = rowsInGroup.reduce((s, r) => s + r.amount, 0);
				return (
					<Card className="[--card-spacing:0px]" key={key}>
						{/* Same grid as rows: total sits under the amounts, picker
						    column empty. */}
						<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3 sm:grid sm:grid-cols-[7rem_1fr_7rem_14rem] sm:gap-3">
							<span className="flex min-w-0 items-center gap-2 sm:col-span-2">
								<span className="truncate font-semibold text-foreground text-sm">
									{label}
								</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									({rowsInGroup.length})
								</span>
							</span>
							<Money
								className="shrink-0 whitespace-nowrap font-medium text-sm sm:text-right"
								signed
								tone="ledger"
								value={groupTotal}
							/>
						</div>
						<div className="divide-y divide-border">
							{rowsInGroup.map((row) => {
								// Block only the row being linked. The save is shared,
								// so a global flag would freeze every picker.
								const linking = link.isPending && link.variables?.id === row.id;
								return (
									<div
										className="flex flex-col gap-2 px-4 py-3 text-sm sm:grid sm:grid-cols-[7rem_1fr_7rem_14rem] sm:items-center sm:gap-3"
										key={row.id}
									>
										<span className="tabular whitespace-nowrap text-muted-foreground">
											{formatDate(row.date)}
										</span>
										<span className="min-w-0 font-medium text-foreground">
											{row.description}
										</span>
										<Money
											className="sm:text-right"
											signed
											tone="ledger"
											value={row.amount}
										/>
										<SelectField
											aria-label={`Link ${row.description} to an expense`}
											className="w-full"
											items={expenseOptions}
											loading={linking}
											onValueChange={(v) => {
												if (v)
													link.mutate({ id: row.id, expenseId: Number(v) });
											}}
											placeholder="Link to expense…"
											value={null}
										/>
									</div>
								);
							})}
						</div>
					</Card>
				);
			})}
		</div>
	);
}
