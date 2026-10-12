"use client";

import {
	ArrowDown,
	ArrowUp,
	ChevronLeft,
	ChevronRight,
	Pencil,
	Plus,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { AsyncBoundary } from "~/components/async-boundary";
import { DeleteConfirmDialog } from "~/components/delete-confirm-dialog";
import { Money } from "~/components/money";
import { PageHeader } from "~/components/page-header";
import { BarSlot } from "~/components/page-skeleton";
import { TransactionsTableSkeleton } from "~/components/route-skeletons";
import {
	SelectField,
	type SelectFieldOption,
	toOptions,
} from "~/components/select-field";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { useHydrating } from "~/hooks/use-hydrating";
import { Frequency, Priority, priorityStyle } from "~/lib/constants";
import { cn, formatDate } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { TransactionForm } from "./transaction-form";
import {
	DEFAULT_FILTERS,
	type ListInput,
	PAGE_SIZE,
	type SortBy,
	toListInput,
} from "./transaction-list-input";

type Transaction = RouterOutputs["transaction"]["list"]["items"][number];

// Filters use null (not "") for "no selection"; the null-valued option both
// labels the trigger and lets the user clear back to "all".
function withAllOption<T extends string>(
	allLabel: string,
	values: readonly T[],
): SelectFieldOption<T | null>[] {
	return [{ value: null, label: allLabel }, ...toOptions(values)];
}

const PRIORITY_FILTER_ITEMS = withAllOption(
	"All priorities",
	Object.values(Priority),
);
const FREQUENCY_FILTER_ITEMS = withAllOption(
	"All frequency",
	Object.values(Frequency),
);

export function TransactionsView() {
	const [search, setSearch] = useState(DEFAULT_FILTERS.search);
	const [priority, setPriority] = useState(DEFAULT_FILTERS.priority);
	const [frequency, setFrequency] = useState(DEFAULT_FILTERS.frequency);
	const [sortBy, setSortBy] = useState(DEFAULT_FILTERS.sortBy);
	const [sortDir, setSortDir] = useState(DEFAULT_FILTERS.sortDir);
	const [page, setPage] = useState(DEFAULT_FILTERS.page);

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Transaction | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);

	const [categories] = api.category.list.useSuspenseQuery();
	const [expenses] = api.expense.list.useSuspenseQuery();

	// Memoised so it only changes with a filter, and the deferred copy below
	// lags only while that filter's rows load.
	const queryInput = useMemo(
		() => toListInput({ search, priority, frequency, sortBy, sortDir, page }),
		[search, priority, frequency, sortBy, sortDir, page],
	);
	// The table keeps the old rows (dimmed) while the new ones load, instead
	// of suspending back to its skeleton.
	const deferredInput = useDeferredValue(queryInput);

	const utils = api.useUtils();
	const remove = api.transaction.delete.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.transaction.list.invalidate(),
				utils.transaction.summary.invalidate(),
				utils.transaction.unplanned.invalidate(),
				// Deleting a linked transaction changes its expense's consumed total.
				utils.expense.consumption.invalidate(),
			]);
		},
	});

	const hasFilters = Boolean(search || priority || frequency);

	function toggleSort(col: SortBy) {
		if (sortBy === col) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(col);
			setSortDir(col === "description" || col === "group" ? "asc" : "desc");
		}
		setPage(0);
	}

	function clearFilters() {
		setSearch("");
		setPriority(null);
		setFrequency(null);
		setPage(0);
	}

	function openAdd() {
		setEditing(null);
		setFormOpen(true);
	}
	function openEdit(tx: Transaction) {
		setEditing(tx);
		setFormOpen(true);
	}

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add transaction
					</Button>
				}
				description={<TransactionCount input={deferredInput} />}
				title="Transaction History"
			/>

			<Card className="mt-6 overflow-visible">
				<CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
						<Input
							className="pl-9"
							onChange={(e) => {
								setSearch(e.target.value);
								setPage(0);
							}}
							placeholder="Search description, group or notes..."
							value={search}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<SelectField
							aria-label={`Filter by priority, currently ${priority ?? "all priorities"}`}
							className="min-w-36"
							items={PRIORITY_FILTER_ITEMS}
							onValueChange={(v) => {
								setPriority(v);
								setPage(0);
							}}
							value={priority}
						/>
						<SelectField
							aria-label={`Filter by frequency, currently ${frequency ?? "all frequency"}`}
							className="min-w-32"
							items={FREQUENCY_FILTER_ITEMS}
							onValueChange={(v) => {
								setFrequency(v);
								setPage(0);
							}}
							value={frequency}
						/>
						{hasFilters && (
							<Button onClick={clearFilters} size="sm" variant="ghost">
								<X className="h-4 w-4" />
								Clear
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Its own boundary: a failed filter shows the card here, and the
			    header and filters keep their state for Try again. */}
			<div className="mt-4">
				<AsyncBoundary
					fade={false}
					label="transactions"
					resetKey={deferredInput}
					skeleton={<TransactionsTableSkeleton />}
				>
					<TransactionsTable
						input={deferredInput}
						onDelete={(tx) => {
							setDeleteTarget(tx);
							setConfirmOpen(true);
						}}
						onEdit={openEdit}
						onPageChange={setPage}
						onSort={toggleSort}
						page={page}
						stale={queryInput !== deferredInput}
					/>
				</AsyncBoundary>
			</div>

			<TransactionForm
				categories={categories}
				expenses={expenses}
				onClose={() => setFormOpen(false)}
				open={formOpen}
				transaction={editing}
			/>

			<DeleteConfirmDialog
				label={deleteTarget?.description}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</div>
	);
}

// Same key as the table's query, so it shares that fetch and never suspends.
function TransactionCount({ input }: { input: ListInput }) {
	// The server can't know if the rows landed before this rendered. A bar until
	// hydrated keeps both sides' markup the same.
	const hydrating = useHydrating();
	const { data, isError } = api.transaction.list.useQuery(input, {
		// Only read the table's result. Own fetches re-ran a failed load and
		// showed a bar beside its error card.
		enabled: false,
	});
	// The table's card says why. A bar would look like it's still loading.
	if (!hydrating && !data && isError) return <span className="block h-5" />;
	if (hydrating || !data) return <BarSlot bar="h-4 w-72" height="h-5" />;
	return `${data.total.toLocaleString()} transactions on record.`;
}

// Module scope: declared inside the table, it remounts on every render and
// drops keyboard focus after a sort.
function SortHeader({
	col,
	input,
	onSort,
	children,
	className,
}: {
	col: SortBy;
	input: ListInput;
	onSort: (col: SortBy) => void;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<button
			className={cn(
				"flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground",
				className,
			)}
			onClick={() => onSort(col)}
			type="button"
		>
			{children}
			{input.sortBy === col &&
				(input.sortDir === "asc" ? (
					<ArrowUp className="h-3 w-3" />
				) : (
					<ArrowDown className="h-3 w-3" />
				))}
		</button>
	);
}

function TransactionsTable({
	input,
	stale,
	page,
	onPageChange,
	onSort,
	onEdit,
	onDelete,
}: {
	input: ListInput;
	/** A newer filter's rows are loading; these are the old ones. */
	stale: boolean;
	page: number;
	onPageChange: (page: number) => void;
	onSort: (col: SortBy) => void;
	onEdit: (tx: Transaction) => void;
	onDelete: (tx: Transaction) => void;
}) {
	const [{ items, total }] = api.transaction.list.useSuspenseQuery(input);
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	// The rows' filters, not the live ones: those run ahead while the rows load.
	const hasFilters = Boolean(input.search || input.priority || input.frequency);

	const pageSum = useMemo(
		() => items.reduce((s, t) => s + t.amount, 0),
		[items],
	);

	const sortHeader = { input, onSort };

	return (
		<Card className="[--card-spacing:0px]">
			<div className="overflow-x-auto">
				<table className="w-full min-w-[52rem] border-collapse text-sm">
					<thead>
						<tr className="border-border border-b bg-muted/40 text-left text-xs">
							<th className="px-4 py-2.5">
								<SortHeader col="date" {...sortHeader}>
									Date
								</SortHeader>
							</th>
							<th className="px-4 py-2.5">
								<SortHeader col="description" {...sortHeader}>
									Description
								</SortHeader>
							</th>
							<th className="px-4 py-2.5">
								<SortHeader col="group" {...sortHeader}>
									Group
								</SortHeader>
							</th>
							<th className="px-4 py-2.5">
								<span className="font-medium text-muted-foreground">
									Expense
								</span>
							</th>
							<th className="px-4 py-2.5">
								<SortHeader col="priority" {...sortHeader}>
									Priority
								</SortHeader>
							</th>
							<th className="px-4 py-2.5 text-right">
								<SortHeader className="ml-auto" col="amount" {...sortHeader}>
									Amount
								</SortHeader>
							</th>
							<th className="w-16 px-4 py-2.5" />
						</tr>
					</thead>
					<tbody
						aria-busy={stale}
						className={cn(
							"divide-y divide-border transition-opacity",
							stale && "opacity-60",
						)}
					>
						{items.map((tx) => {
							const ps = priorityStyle(tx.priority);
							return (
								<tr className="group hover:bg-muted/30" key={tx.id}>
									<td className="tabular whitespace-nowrap px-4 py-3 text-muted-foreground">
										{formatDate(tx.date)}
									</td>
									<td className="px-4 py-3">
										<span className="font-medium text-foreground">
											{tx.description}
										</span>
										{tx.notes && (
											<span className="mt-0.5 block text-muted-foreground text-xs">
												{tx.notes}
											</span>
										)}
									</td>
									<td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
										{tx.group}
										{tx.categoryName && (
											<span className="mt-0.5 block text-muted-foreground text-xs">
												<span className="sr-only">Category: </span>
												{tx.categoryName}
											</span>
										)}
									</td>
									<td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
										{tx.expenseName ?? "—"}
									</td>
									<td className="whitespace-nowrap px-4 py-3">
										<Badge className={ps.badge}>
											<span
												className={cn("h-1.5 w-1.5 rounded-full", ps.dot)}
											/>
											{ps.label}
										</Badge>
									</td>
									<td className="whitespace-nowrap px-4 py-3 text-right">
										<Money signed tone="ledger" value={tx.amount} />
									</td>
									<td className="px-4 py-3">
										<div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
											<button
												aria-label={`Edit ${tx.description}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
												onClick={() => onEdit(tx)}
												type="button"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												aria-label={`Delete ${tx.description}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
												onClick={() => onDelete(tx)}
												type="button"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									</td>
								</tr>
							);
						})}
						{!items.length && (
							<tr>
								<td
									className="px-4 py-16 text-center text-muted-foreground text-sm"
									colSpan={7}
								>
									{hasFilters
										? "No transactions match your filters."
										: "No transactions yet."}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			<div className="flex flex-col gap-3 border-border border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
				<span className="text-muted-foreground">
					Page total:{" "}
					<Money className="font-medium" signed tone="ledger" value={pageSum} />
				</span>
				<div className="flex items-center gap-3">
					<span className="text-muted-foreground">
						{/* Page of the loaded rows, not the newer one still loading. */}
						Page {(input.offset ?? 0) / PAGE_SIZE + 1} of {totalPages}
					</span>
					<div className="flex gap-1">
						<Button
							aria-label="Previous page"
							disabled={page === 0}
							onClick={() => onPageChange(Math.max(0, page - 1))}
							size="icon"
							variant="outline"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<Button
							aria-label="Next page"
							// The page count is the old rows' until the new ones land.
							disabled={stale || page + 1 >= totalPages}
							// Pressing it turns it off for the load; keep focus on it.
							focusableWhenDisabled
							onClick={() => onPageChange(page + 1)}
							size="icon"
							variant="outline"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>
		</Card>
	);
}
