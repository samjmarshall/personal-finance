"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "~/app/_components/page-header";
import { Button, Card } from "~/app/_components/ui/primitives";
import { Money } from "~/app/_components/ui/money";
import { api, type RouterOutputs } from "~/trpc/react";
import { ExpenseForm } from "./expense-form";

type Expense = RouterOutputs["expense"]["list"][number];

export function ExpensesView() {
	const [list] = api.expense.list.useSuspenseQuery();
	const utils = api.useUtils();
	const remove = api.expense.delete.useMutation({
		onSuccess: () => utils.expense.list.invalidate(),
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Expense | null>(null);

	const groups = useMemo(() => {
		const map = new Map<string, Expense[]>();
		for (const item of list) {
			const arr = map.get(item.category) ?? [];
			arr.push(item);
			map.set(item.category, arr);
		}
		return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	}, [list]);

	const totals = useMemo(
		() => ({
			fortnight: list.reduce((s, e) => s + (e.fortnight ?? 0), 0),
			month: list.reduce((s, e) => s + (e.month ?? 0), 0),
			year: list.reduce((s, e) => s + (e.year ?? 0), 0),
		}),
		[list],
	);

	function openAdd() {
		setEditing(null);
		setFormOpen(true);
	}
	function openEdit(expense: Expense) {
		setEditing(expense);
		setFormOpen(true);
	}

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				title="Expenses"
				description="Your budgeted outgoings, grouped by category."
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add expense
					</Button>
				}
			/>

			<div className="mt-6 grid grid-cols-3 gap-4">
				{(
					[
						["Per fortnight", totals.fortnight],
						["Per month", totals.month],
						["Per year", totals.year],
					] as const
				).map(([label, value]) => (
					<Card key={label} className="p-4">
						<p className="text-xs font-medium text-muted-foreground">{label}</p>
						<Money
							value={value}
							className="mt-1.5 block text-lg font-semibold text-foreground sm:text-xl"
						/>
					</Card>
				))}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{groups.map(([category, items]) => {
					const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
					return (
						<Card key={category} className="overflow-hidden">
							<div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
								<h2 className="text-sm font-semibold text-foreground">
									{category}
								</h2>
								<span className="text-xs text-muted-foreground">
									<Money value={groupTotal} className="font-medium" /> / mo
								</span>
							</div>
							<div className="divide-y divide-border">
								<div className="hidden grid-cols-[1fr_repeat(3,7rem)_3rem] items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
									<span>Item</span>
									<span className="text-right">Fortnight</span>
									<span className="text-right">Month</span>
									<span className="text-right">Year</span>
									<span />
								</div>
								{items.map((item) => (
									<div
										key={item.id}
										className="group grid grid-cols-2 items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_repeat(3,7rem)_3rem]"
									>
										<span className="font-medium text-foreground">
											{item.name}
										</span>
										<Money
											value={item.fortnight}
											className="hidden text-right text-muted-foreground sm:block"
										/>
										<Money
											value={item.month}
											className="text-right font-medium text-foreground"
										/>
										<Money
											value={item.year}
											className="hidden text-right text-muted-foreground sm:block"
										/>
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
											<button
												onClick={() => openEdit(item)}
												aria-label={`Edit ${item.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												onClick={() => {
													if (confirm(`Delete "${item.name}"?`))
														remove.mutate({ id: item.id });
												}}
												aria-label={`Delete ${item.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								))}
							</div>
						</Card>
					);
				})}

				{!groups.length && (
					<Card className="p-10 text-center">
						<p className="text-sm text-muted-foreground">
							No expenses yet. Add your first budgeted item to get started.
						</p>
						<Button onClick={openAdd} size="sm" className="mt-4">
							<Plus className="h-4 w-4" />
							Add expense
						</Button>
					</Card>
				)}
			</div>

			<ExpenseForm
				open={formOpen}
				onClose={() => setFormOpen(false)}
				expense={editing}
			/>
		</div>
	);
}
