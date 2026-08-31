"use client";

import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { DeleteConfirmDialog } from "~/app/_components/delete-confirm-dialog";
import { Money } from "~/app/_components/money";
import { PageHeader } from "~/app/_components/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { CommitmentKind } from "~/lib/constants";
import { cn, formatCurrency, formatDate, isPast } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { ExpenseForm } from "./expense-form";

type Expense = RouterOutputs["expense"]["list"][number];

// Collapse-Set key for the one-time "past" group. Sentinel that can't collide
// with a category name (which drives the same Set).
const PAST_KEY = "__onetime_past__";

export function ExpensesView() {
	const [list] = api.expense.list.useSuspenseQuery();
	const [consumption] = api.expense.consumption.useSuspenseQuery();
	const { data: categories } = api.category.list.useQuery();
	const utils = api.useUtils();
	const remove = api.expense.delete.useMutation({
		onSuccess: () => utils.expense.list.invalidate(),
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Expense | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
	// Past group starts collapsed — bygone one-times are the least relevant.
	const [collapsed, setCollapsed] = useState<Set<string>>(
		() => new Set([PAST_KEY]),
	);

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
			// One-time expenses live in their own section, not the category cards.
			if (item.kind !== CommitmentKind.Recurring) continue;
			const arr = map.get(item.category) ?? [];
			arr.push(item);
			map.set(item.category, arr);
		}
		// Rank each category by its managed sortOrder; categories without a
		// managed record fall to the end and are broken by name.
		const order = new Map(
			(categories ?? []).map((c, i) => [c.name, c.sortOrder * 1000 + i]),
		);
		const rank = (name: string) => order.get(name) ?? Number.MAX_SAFE_INTEGER;
		return [...map.entries()].sort(
			(a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
		);
	}, [list, categories]);

	// Summary totals are recurring-only — one-time figures aren't a cadence.
	const totals = useMemo(() => {
		const recurring = list.filter((e) => e.kind === CommitmentKind.Recurring);
		return {
			fortnight: recurring.reduce((s, e) => s + (e.fortnight ?? 0), 0),
			month: recurring.reduce((s, e) => s + (e.month ?? 0), 0),
			year: recurring.reduce((s, e) => s + (e.year ?? 0), 0),
		};
	}, [list]);

	const consumedById = useMemo(
		() => new Map(consumption.map((c) => [c.expenseId, c.consumed])),
		[consumption],
	);

	const { oneTime, upcoming, past, oneTimeTotal } = useMemo(() => {
		const now = new Date();
		const items = list.filter((e) => e.kind === CommitmentKind.OneTime);
		const up: Expense[] = [];
		const pa: Expense[] = [];
		for (const e of items) {
			if (e.expectedDate && isPast(e.expectedDate, now)) pa.push(e);
			else up.push(e);
		}
		const byDate = (a: Expense, b: Expense) =>
			(a.expectedDate?.getTime() ?? 0) - (b.expectedDate?.getTime() ?? 0);
		up.sort(byDate); // soonest first
		pa.sort((a, b) => byDate(b, a)); // most recent first
		return {
			oneTime: items,
			upcoming: up,
			past: pa,
			oneTimeTotal: items.reduce((s, e) => s + (e.amount ?? 0), 0),
		};
	}, [list]);

	function openAdd() {
		setEditing(null);
		setFormOpen(true);
	}
	function openEdit(expense: Expense) {
		setEditing(expense);
		setFormOpen(true);
	}

	function oneTimeRow(item: Expense) {
		const consumed = consumedById.get(item.id) ?? 0;
		const remaining = (item.amount ?? 0) - consumed;
		return (
			<div
				className="group grid grid-cols-2 items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_repeat(4,7rem)_3rem]"
				key={item.id}
			>
				<span className="font-medium text-foreground">{item.name}</span>
				<Money
					className="hidden text-right text-muted-foreground sm:block"
					value={item.amount}
				/>
				<span className="hidden text-right text-muted-foreground sm:block">
					{formatDate(item.expectedDate)}
				</span>
				<Money
					className="hidden text-right text-muted-foreground sm:block"
					value={consumed}
				/>
				{/* Balance, not a ledger figure: explicit − and warning tone when over-consumed. */}
				<span
					className={cn(
						"tabular text-right font-medium tracking-tight",
						remaining < 0 ? "text-spend" : "text-foreground",
					)}
				>
					{remaining < 0 && "−"}
					{formatCurrency(Math.abs(remaining))}
				</span>
				<div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
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
							setDeleteTarget(item);
							setConfirmOpen(true);
						}}
						type="button"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		);
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
								className="mt-1.5 block font-semibold text-foreground text-lg sm:text-xl"
								value={value}
							/>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{groups.map(([category, items]) => {
					const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
					const isCollapsed = collapsed.has(category);
					const panelId = `expense-group-${category.replace(/\s+/g, "-")}`;
					return (
						<Card className="[--card-spacing:0px]" key={category}>
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
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
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

				{oneTime.length > 0 && (
					<Card className="[--card-spacing:0px]">
						<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3">
							<span className="flex items-center gap-2">
								<span className="font-semibold text-foreground text-sm">
									One-time
								</span>
								<span className="text-muted-foreground text-xs">
									({oneTime.length})
								</span>
							</span>
							<span className="text-muted-foreground text-xs">
								<Money className="font-medium" value={oneTimeTotal} /> total
							</span>
						</div>
						<div className="divide-y divide-border">
							<div className="hidden grid-cols-[1fr_repeat(4,7rem)_3rem] items-center gap-2 px-4 py-2 font-medium text-muted-foreground text-xs sm:grid">
								<span>Item</span>
								<span className="text-right">Amount</span>
								<span className="text-right">Expected</span>
								<span className="text-right">Consumed</span>
								<span className="text-right">Remaining</span>
								<span />
							</div>
							{upcoming.map(oneTimeRow)}
							{past.length > 0 && (
								<div>
									<button
										aria-controls="expense-onetime-past"
										aria-expanded={!collapsed.has(PAST_KEY)}
										className="flex w-full items-center gap-2 px-4 py-2 text-left text-muted-foreground text-xs transition-colors hover:text-foreground"
										onClick={() => toggleCategory(PAST_KEY)}
										type="button"
									>
										<ChevronDown
											className={cn(
												"h-3.5 w-3.5 shrink-0 transition-transform",
												collapsed.has(PAST_KEY) && "-rotate-90",
											)}
										/>
										Past ({past.length})
									</button>
									<div
										className="divide-y divide-border border-border border-t"
										hidden={collapsed.has(PAST_KEY)}
										id="expense-onetime-past"
									>
										{past.map(oneTimeRow)}
									</div>
								</div>
							)}
						</div>
					</Card>
				)}

				{!groups.length && !oneTime.length && (
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent>
							<p className="text-muted-foreground text-sm">
								No expenses yet. Add your first budgeted item to get started.
							</p>
							<Button className="mt-4" onClick={openAdd} size="sm">
								<Plus className="h-4 w-4" />
								Add expense
							</Button>
						</CardContent>
					</Card>
				)}
			</div>

			<ExpenseForm
				expense={editing}
				onClose={() => setFormOpen(false)}
				open={formOpen}
			/>

			<DeleteConfirmDialog
				label={deleteTarget?.name}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</div>
	);
}
