"use client";

import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "~/app/_components/page-header";
import { Money } from "~/app/_components/ui/money";
import { Button, Card } from "~/app/_components/ui/primitives";
import { cn } from "~/lib/utils";
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
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	function toggleCategory(category: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			return next;
		});
	}

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
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add expense
					</Button>
				}
				description="Your budgeted outgoings, grouped by category."
				title="Expenses"
			/>

			<div className="mt-6 grid grid-cols-3 gap-4">
				{(
					[
						["Per fortnight", totals.fortnight],
						["Per month", totals.month],
						["Per year", totals.year],
					] as const
				).map(([label, value]) => (
					<Card className="p-4" key={label}>
						<p className="font-medium text-muted-foreground text-xs">{label}</p>
						<Money
							className="mt-1.5 block font-semibold text-foreground text-lg sm:text-xl"
							value={value}
						/>
					</Card>
				))}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{groups.map(([category, items]) => {
					const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
					const isCollapsed = collapsed.has(category);
					const panelId = `expense-group-${category.replace(/\s+/g, "-")}`;
					return (
						<Card className="overflow-hidden" key={category}>
							<button
								aria-controls={panelId}
								aria-expanded={!isCollapsed}
								className="flex w-full items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70"
								onClick={() => toggleCategory(category)}
								type="button"
							>
								<span className="flex items-center gap-2">
									<ChevronDown
										className={cn(
											"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
											isCollapsed && "-rotate-90",
										)}
									/>
									<span className="font-semibold text-foreground text-sm">
										{category}
									</span>
									<span className="text-muted-foreground text-xs">
										({items.length})
									</span>
								</span>
								<span className="text-muted-foreground text-xs">
									<Money className="font-medium" value={groupTotal} /> / mo
								</span>
							</button>
							<div
								className="divide-y divide-border"
								hidden={isCollapsed}
								id={panelId}
							>
								<div className="hidden grid-cols-[1fr_repeat(3,7rem)_3rem] items-center gap-2 px-4 py-2 font-medium text-muted-foreground text-xs sm:grid">
									<span>Item</span>
									<span className="text-right">Fortnight</span>
									<span className="text-right">Month</span>
									<span className="text-right">Year</span>
									<span />
								</div>
								{items.map((item) => (
									<div
										className="group grid grid-cols-2 items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_repeat(3,7rem)_3rem]"
										key={item.id}
									>
										<span className="font-medium text-foreground">
											{item.name}
										</span>
										<Money
											className="hidden text-right text-muted-foreground sm:block"
											value={item.fortnight}
										/>
										<Money
											className="text-right font-medium text-foreground"
											value={item.month}
										/>
										<Money
											className="hidden text-right text-muted-foreground sm:block"
											value={item.year}
										/>
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
											<button
												aria-label={`Edit ${item.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
												onClick={() => openEdit(item)}
												type="button"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												aria-label={`Delete ${item.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
												onClick={() => {
													if (confirm(`Delete "${item.name}"?`))
														remove.mutate({ id: item.id });
												}}
												type="button"
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
						<p className="text-muted-foreground text-sm">
							No expenses yet. Add your first budgeted item to get started.
						</p>
						<Button className="mt-4" onClick={openAdd} size="sm">
							<Plus className="h-4 w-4" />
							Add expense
						</Button>
					</Card>
				)}
			</div>

			<ExpenseForm
				expense={editing}
				key={editing ? `edit-${editing.id}` : "add"}
				onClose={() => setFormOpen(false)}
				open={formOpen}
			/>
		</div>
	);
}
