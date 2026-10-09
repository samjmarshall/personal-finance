"use client";

import { Tabs } from "@base-ui/react/tabs";
import {
	CalendarClock,
	ChevronDown,
	Pencil,
	Plus,
	Repeat,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { DeleteConfirmDialog } from "~/components/delete-confirm-dialog";
import { Money } from "~/components/money";
import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { CommitmentKind } from "~/lib/constants";
import { cn, formatCurrency, formatDate, isPast } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { ExpenseForm } from "./expense-form";
import { groupByCategory } from "./group-by-category";

type Expense = RouterOutputs["expense"]["list"][number];

export function ExpensesView() {
	const [list] = api.expense.list.useSuspenseQuery();
	const [consumption] = api.expense.consumption.useSuspenseQuery();
	const [categories] = api.category.list.useSuspenseQuery();
	const utils = api.useUtils();
	const remove = api.expense.delete.useMutation({
		onSuccess: async () => {
			// Deleting an Expense unlinks its Transactions (they keep its Category):
			// they leave the consumed total and reappear on Unplanned.
			await Promise.all([
				utils.expense.list.invalidate(),
				utils.expense.consumption.invalidate(),
				// Only the Categories page shows counts; refetch now so it opens fresh.
				utils.expense.countsByCategory.invalidate(undefined, {
					refetchType: "all",
				}),
				utils.transaction.unplanned.invalidate(),
				utils.transaction.list.invalidate(),
			]);
		},
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Expense | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
	// Cards start open; this tracks closed ones. A Category can hold recurring and
	// one-time, so each kind gets its own key.
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

	function toggle(key: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	const recurringGroups = useMemo(
		() =>
			groupByCategory(
				list.filter((e) => e.kind === CommitmentKind.Recurring),
				categories,
			),
		[list, categories],
	);

	const oneTime = useMemo(
		() => list.filter((e) => e.kind === CommitmentKind.OneTime),
		[list],
	);
	const oneTimeGroups = useMemo(
		() => groupByCategory(oneTime, categories),
		[oneTime, categories],
	);

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

	// Fresh now each render so an item that becomes past — e.g. the page sat open
	// across midnight — re-classifies on any re-render. The list is tiny.
	const now = new Date();
	const isPastItem = (item: Expense) =>
		item.expectedDate ? isPast(item.expectedDate, now) : false;

	function openAdd() {
		setEditing(null);
		setFormOpen(true);
	}
	function openEdit(expense: Expense) {
		setEditing(expense);
		setFormOpen(true);
	}
	function askDelete(expense: Expense) {
		setDeleteTarget(expense);
		setConfirmOpen(true);
	}

	function rowActions(item: Expense) {
		return (
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
					onClick={() => askDelete(item)}
					type="button"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</button>
			</div>
		);
	}

	function oneTimeRow(item: Expense) {
		const consumed = consumedById.get(item.id) ?? 0;
		const remaining = (item.amount ?? 0) - consumed;
		// Float subtraction can leave a sub-cent negative on an exactly-met budget;
		// only treat it as over-consumed past half a cent so it never shows −$0.00.
		const isOver = remaining < -0.005;
		return (
			<div
				className={cn(
					"group grid grid-cols-2 items-center gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_repeat(4,7rem)_3rem]",
					isPastItem(item) && "opacity-55",
				)}
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
						isOver ? "text-spend" : "text-foreground",
					)}
				>
					{isOver && "−"}
					{formatCurrency(Math.abs(remaining))}
				</span>
				{rowActions(item)}
			</div>
		);
	}

	const tab = (
		value: string,
		icon: React.ReactNode,
		label: string,
		count: number,
	) => (
		<Tabs.Tab
			className="flex items-center gap-2 rounded-full px-4 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-sm data-active:ring-1 data-active:ring-foreground/10"
			value={value}
		>
			{icon}
			{label}
			<span className="text-muted-foreground text-xs">({count})</span>
		</Tabs.Tab>
	);

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add expense
					</Button>
				}
				description="Your budgeted outgoings, split by cadence."
				title="Expenses"
			/>

			<Tabs.Root className="mt-6" defaultValue="recurring">
				<Tabs.List className="inline-flex gap-1 rounded-full bg-muted/50 p-1">
					{tab(
						"recurring",
						<Repeat className="h-4 w-4" />,
						"Recurring",
						recurringGroups.reduce((s, { items }) => s + items.length, 0),
					)}
					{tab(
						"onetime",
						<CalendarClock className="h-4 w-4" />,
						"One-time",
						oneTime.length,
					)}
				</Tabs.List>

				<Tabs.Panel value="recurring">
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

					<div className="mt-6 flex flex-col gap-4">
						{recurringGroups.map(({ key: groupKey, label, items }) => {
							const groupTotal = items.reduce((s, e) => s + (e.month ?? 0), 0);
							const key = `r:${groupKey}`;
							const isCollapsed = collapsed.has(key);
							const panelId = `expense-recurring-${groupKey}`;
							return (
								<Card className="[--card-spacing:0px]" key={key}>
									<button
										aria-controls={panelId}
										aria-expanded={!isCollapsed}
										className="flex w-full items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70"
										onClick={() => toggle(key)}
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
												{label}
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
												{rowActions(item)}
											</div>
										))}
									</div>
								</Card>
							);
						})}

						{!recurringGroups.length && (
							<Card className="text-center [--card-spacing:--spacing(10)]">
								<CardContent>
									<p className="text-muted-foreground text-sm">
										No recurring expenses yet. Add your first budgeted item to
										get started.
									</p>
									<Button className="mt-4" onClick={openAdd} size="sm">
										<Plus className="h-4 w-4" />
										Add expense
									</Button>
								</CardContent>
							</Card>
						)}
					</div>
				</Tabs.Panel>

				<Tabs.Panel value="onetime">
					<div className="mt-6 flex flex-col gap-4">
						{oneTimeGroups.map(({ key: groupKey, label, items: itemsRaw }) => {
							// Upcoming first (soonest → latest), then past (most recent → oldest).
							const items = [...itemsRaw].sort((a, b) => {
								const pa = isPastItem(a);
								const pb = isPastItem(b);
								if (pa !== pb) return pa ? 1 : -1;
								const da = a.expectedDate?.getTime() ?? 0;
								const db = b.expectedDate?.getTime() ?? 0;
								return pa ? db - da : da - db;
							});
							const total = items.reduce((s, e) => s + (e.amount ?? 0), 0);
							const key = `o:${groupKey}`;
							const isCollapsed = collapsed.has(key);
							const panelId = `expense-onetime-${groupKey}`;
							return (
								<Card className="[--card-spacing:0px]" key={key}>
									<button
										aria-controls={panelId}
										aria-expanded={!isCollapsed}
										className="flex w-full items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70"
										onClick={() => toggle(key)}
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
												{label}
											</span>
											<span className="text-muted-foreground text-xs">
												({items.length})
											</span>
										</span>
										<span className="text-muted-foreground text-xs">
											<Money className="font-medium" value={total} /> total
										</span>
									</button>
									<div
										className="divide-y divide-border"
										hidden={isCollapsed}
										id={panelId}
									>
										<div className="hidden grid-cols-[1fr_repeat(4,7rem)_3rem] items-center gap-2 px-4 py-2 font-medium text-muted-foreground text-xs sm:grid">
											<span>Item</span>
											<span className="text-right">Amount</span>
											<span className="text-right">Expected</span>
											<span className="text-right">Consumed</span>
											<span className="text-right">Remaining</span>
											<span />
										</div>
										{items.map(oneTimeRow)}
									</div>
								</Card>
							);
						})}

						{!oneTime.length && (
							<Card className="text-center [--card-spacing:--spacing(10)]">
								<CardContent>
									<p className="text-muted-foreground text-sm">
										No one-time expenses yet. Add a dated, one-off outgoing to
										track it here.
									</p>
									<Button className="mt-4" onClick={openAdd} size="sm">
										<Plus className="h-4 w-4" />
										Add expense
									</Button>
								</CardContent>
							</Card>
						)}
					</div>
				</Tabs.Panel>
			</Tabs.Root>

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
