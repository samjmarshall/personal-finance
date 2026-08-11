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
import { useMemo, useState } from "react";

import { PageHeader } from "~/app/_components/page-header";
import { Money } from "~/app/_components/ui/money";
import { Select } from "~/app/_components/ui/primitives";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { FREQUENCIES, PRIORITIES, priorityStyle } from "~/lib/constants";
import { cn, formatDate } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { TransactionForm } from "./transaction-form";

type Transaction = RouterOutputs["transaction"]["list"]["items"][number];
type SortBy = "date" | "description" | "amount" | "category" | "priority";

const PAGE_SIZE = 50;

export function TransactionsView() {
	const [search, setSearch] = useState("");
	const [priority, setPriority] = useState("");
	const [frequency, setFrequency] = useState("");
	const [sortBy, setSortBy] = useState<SortBy>("date");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
	const [page, setPage] = useState(0);

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Transaction | null>(null);

	const [categories] = api.transaction.categories.useSuspenseQuery();

	const queryInput = {
		search: search || undefined,
		priority: priority || undefined,
		frequency: frequency || undefined,
		sortBy,
		sortDir,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	};

	const { data, isFetching } = api.transaction.list.useQuery(queryInput, {
		placeholderData: (prev) => prev,
	});

	const utils = api.useUtils();
	const remove = api.transaction.delete.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.transaction.list.invalidate(),
				utils.transaction.summary.invalidate(),
			]);
		},
	});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const hasFilters = Boolean(search || priority || frequency);

	const pageSum = useMemo(
		() => items.reduce((s, t) => s + t.amount, 0),
		[items],
	);

	function toggleSort(col: SortBy) {
		if (sortBy === col) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(col);
			setSortDir(col === "description" || col === "category" ? "asc" : "desc");
		}
		setPage(0);
	}

	function clearFilters() {
		setSearch("");
		setPriority("");
		setFrequency("");
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

	const SortHeader = ({
		col,
		children,
		className,
	}: {
		col: SortBy;
		children: React.ReactNode;
		className?: string;
	}) => (
		<button
			className={cn(
				"flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground",
				className,
			)}
			onClick={() => toggleSort(col)}
			type="button"
		>
			{children}
			{sortBy === col &&
				(sortDir === "asc" ? (
					<ArrowUp className="h-3 w-3" />
				) : (
					<ArrowDown className="h-3 w-3" />
				))}
		</button>
	);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add transaction
					</Button>
				}
				description={`${total.toLocaleString()} transactions on record.`}
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
							placeholder="Search description, category or notes..."
							value={search}
						/>
					</div>
					<div className="flex gap-2">
						<Select
							className="w-auto min-w-36"
							onChange={(e) => {
								setPriority(e.target.value);
								setPage(0);
							}}
							value={priority}
						>
							<option value="">All priorities</option>
							{PRIORITIES.map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</Select>
						<Select
							className="w-auto min-w-32"
							onChange={(e) => {
								setFrequency(e.target.value);
								setPage(0);
							}}
							value={frequency}
						>
							<option value="">All frequency</option>
							{FREQUENCIES.map((f) => (
								<option key={f} value={f}>
									{f}
								</option>
							))}
						</Select>
						{hasFilters && (
							<Button onClick={clearFilters} size="sm" variant="ghost">
								<X className="h-4 w-4" />
								Clear
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card className="mt-4 [--card-spacing:0px]">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[52rem] border-collapse text-sm">
						<thead>
							<tr className="border-border border-b bg-muted/40 text-left text-xs">
								<th className="px-4 py-2.5">
									<SortHeader col="date">Date</SortHeader>
								</th>
								<th className="px-4 py-2.5">
									<SortHeader col="description">Description</SortHeader>
								</th>
								<th className="px-4 py-2.5">
									<SortHeader col="category">Category</SortHeader>
								</th>
								<th className="px-4 py-2.5">
									<SortHeader col="priority">Priority</SortHeader>
								</th>
								<th className="px-4 py-2.5 text-right">
									<SortHeader className="ml-auto" col="amount">
										Amount
									</SortHeader>
								</th>
								<th className="w-16 px-4 py-2.5" />
							</tr>
						</thead>
						<tbody
							className={cn(
								"divide-y divide-border transition-opacity",
								isFetching && "opacity-60",
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
											{tx.category}
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
											<div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
												<button
													aria-label={`Edit ${tx.description}`}
													className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
													onClick={() => openEdit(tx)}
													type="button"
												>
													<Pencil className="h-3.5 w-3.5" />
												</button>
												<button
													aria-label={`Delete ${tx.description}`}
													className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
													onClick={() => {
														if (confirm(`Delete "${tx.description}"?`))
															remove.mutate({ id: tx.id });
													}}
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
										colSpan={6}
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
						<Money
							className="font-medium"
							signed
							tone="ledger"
							value={pageSum}
						/>
					</span>
					<div className="flex items-center gap-3">
						<span className="text-muted-foreground">
							Page {page + 1} of {totalPages}
						</span>
						<div className="flex gap-1">
							<Button
								aria-label="Previous page"
								disabled={page === 0}
								onClick={() => setPage((p) => Math.max(0, p - 1))}
								size="icon"
								variant="outline"
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button
								aria-label="Next page"
								disabled={page + 1 >= totalPages}
								onClick={() => setPage((p) => p + 1)}
								size="icon"
								variant="outline"
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					</div>
				</div>
			</Card>

			<TransactionForm
				categories={categories}
				onClose={() => setFormOpen(false)}
				open={formOpen}
				transaction={editing}
			/>
		</div>
	);
}
