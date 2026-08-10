"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "~/app/_components/page-header";
import { Button, Card } from "~/app/_components/ui/primitives";
import { Money } from "~/app/_components/ui/money";
import { api, type RouterOutputs } from "~/trpc/react";
import { IncomeForm } from "./income-form";

type Income = RouterOutputs["income"]["list"][number];

export function IncomeView() {
	const [list] = api.income.list.useSuspenseQuery();
	const utils = api.useUtils();
	const remove = api.income.delete.useMutation({
		onSuccess: () => utils.income.list.invalidate(),
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Income | null>(null);

	const groups = useMemo(() => {
		const map = new Map<string, Income[]>();
		for (const item of list) {
			const arr = map.get(item.person) ?? [];
			arr.push(item);
			map.set(item.person, arr);
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
	function openEdit(item: Income) {
		setEditing(item);
		setFormOpen(true);
	}

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				title="Income"
				description="Money coming in each fortnight, by person."
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add income
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
							tone="income"
							className="mt-1.5 block text-lg font-semibold sm:text-xl"
						/>
					</Card>
				))}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{groups.map(([person, items]) => {
					const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
					return (
						<Card key={person} className="overflow-hidden">
							<div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
								<h2 className="text-sm font-semibold text-foreground">
									{person}
								</h2>
								<span className="text-xs text-muted-foreground">
									<Money value={groupTotal} tone="income" className="font-medium" />{" "}
									/ mo
								</span>
							</div>
							<div className="divide-y divide-border">
								<div className="hidden grid-cols-[1fr_repeat(3,7rem)_3rem] items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
									<span>Source</span>
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
											{item.source}
										</span>
										<Money
											value={item.fortnight}
											tone="income"
											className="hidden text-right sm:block"
										/>
										<Money
											value={item.month}
											tone="income"
											className="text-right font-medium"
										/>
										<Money
											value={item.year}
											tone="income"
											className="hidden text-right sm:block"
										/>
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
											<button
												onClick={() => openEdit(item)}
												aria-label={`Edit ${item.source}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												onClick={() => {
													if (confirm(`Delete "${item.source}"?`))
														remove.mutate({ id: item.id });
												}}
												aria-label={`Delete ${item.source}`}
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
							No income sources yet. Add one to get started.
						</p>
						<Button onClick={openAdd} size="sm" className="mt-4">
							<Plus className="h-4 w-4" />
							Add income
						</Button>
					</Card>
				)}
			</div>

			<IncomeForm
				open={formOpen}
				onClose={() => setFormOpen(false)}
				income={editing}
			/>
		</div>
	);
}
