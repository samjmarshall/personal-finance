"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { DeleteConfirmDialog } from "~/app/_components/delete-confirm-dialog";
import { Money } from "~/app/_components/money";
import { PageHeader } from "~/app/_components/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
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
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Income | null>(null);

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
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add income
					</Button>
				}
				description="Money coming in each fortnight, by person."
				title="Income"
			/>

			<div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
				{(
					[
						["Per fortnight", totals.fortnight],
						["Per month", totals.month],
						["Per year", totals.year],
					] as const
				).map(([label, value]) => (
					<Card key={label}>
						<CardContent>
							<p className="font-medium text-muted-foreground text-xs">
								{label}
							</p>
							<Money
								className="mt-1.5 block font-semibold text-lg sm:text-xl"
								tone="income"
								value={value}
							/>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{groups.map(([person, items]) => {
					const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
					return (
						<Card className="[--card-spacing:0px]" key={person}>
							<div className="flex items-center justify-between border-border border-b bg-muted/40 px-4 py-3">
								<h2 className="font-semibold text-foreground text-sm">
									{person}
								</h2>
								<span className="text-muted-foreground text-xs">
									<Money
										className="font-medium"
										tone="income"
										value={groupTotal}
									/>{" "}
									/ mo
								</span>
							</div>
							<div className="divide-y divide-border">
								<div className="hidden grid-cols-[1fr_repeat(3,7rem)_3rem] items-center gap-2 px-4 py-2 font-medium text-muted-foreground text-xs sm:grid">
									<span>Source</span>
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
											{item.source}
										</span>
										<Money
											className="hidden text-right sm:block"
											tone="income"
											value={item.fortnight}
										/>
										<Money
											className="text-right font-medium"
											tone="income"
											value={item.month}
										/>
										<Money
											className="hidden text-right sm:block"
											tone="income"
											value={item.year}
										/>
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
											<button
												aria-label={`Edit ${item.source}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
												onClick={() => openEdit(item)}
												type="button"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												aria-label={`Delete ${item.source}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
												onClick={() => {
													setDeleteTarget(item);
													setConfirmOpen(true);
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
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent>
							<p className="text-muted-foreground text-sm">
								No income sources yet. Add one to get started.
							</p>
							<Button className="mt-4" onClick={openAdd} size="sm">
								<Plus className="h-4 w-4" />
								Add income
							</Button>
						</CardContent>
					</Card>
				)}
			</div>

			<IncomeForm
				income={editing}
				onClose={() => setFormOpen(false)}
				open={formOpen}
			/>

			<DeleteConfirmDialog
				label={deleteTarget?.source}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</div>
	);
}
