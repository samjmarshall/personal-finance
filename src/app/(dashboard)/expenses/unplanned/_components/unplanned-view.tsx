"use client";

import { skipToken } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Money } from "~/components/money";
import { PageHeader } from "~/components/page-header";
import { SelectField } from "~/components/select-field";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	fortnightWindow,
	monthWindow,
	type PeriodKind,
	type PeriodWindow,
	shiftWindow,
} from "~/lib/period";
import { cn, formatDate, fromDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type UnplannedRow = RouterOutputs["transaction"]["unplanned"][number];

const monthLabelFormatter = new Intl.DateTimeFormat("en-AU", {
	month: "long",
	year: "numeric",
});

function periodLabel(kind: PeriodKind, range: PeriodWindow): string {
	if (kind === "month") return monthLabelFormatter.format(range.from);
	// Window is half-open [from, to); show the inclusive last day.
	const last = new Date(range.to);
	last.setDate(last.getDate() - 1);
	return `${formatDate(range.from)} – ${formatDate(last)}`;
}

export function UnplannedView() {
	const [anchor] = api.setting.fortnightAnchor.useSuspenseQuery();
	const [expenses] = api.expense.list.useSuspenseQuery();
	const [categories] = api.category.list.useSuspenseQuery();

	// Memoised so it's a stable effect dependency (fromDateInput mints a fresh
	// Date each call) and parsed once, not again in the seed effect below.
	const anchorDate = useMemo(
		() => (anchor ? fromDateInput(anchor) : null),
		[anchor],
	);

	// Fortnight needs the anchor to seed its grid; without one the picker is
	// month-only (design: degrade, never error).
	const [kind, setKind] = useState<PeriodKind>(
		anchorDate ? "fortnight" : "month",
	);
	// Defer to effect: new Date() is UTC on the server but local-tz in the browser,
	// so seeding during render causes a hydration mismatch at day boundaries.
	// kind is co-seeded here so it can't desync from the window if the anchor
	// arrives after mount.
	const [range, setRange] = useState<PeriodWindow | null>(null);
	useEffect(() => {
		const now = new Date();
		setKind(anchorDate ? "fortnight" : "month");
		setRange(anchorDate ? fortnightWindow(anchorDate, now) : monthWindow(now));
	}, [anchorDate]);

	const {
		data: rows,
		isFetching,
		isError,
		refetch,
	} = api.transaction.unplanned.useQuery(
		range ? { from: range.from, to: range.to } : skipToken,
		{ placeholderData: (prev) => prev },
	);

	const utils = api.useUtils();
	const link = api.transaction.linkExpense.useMutation({
		onSuccess: () => {
			// Linking moves the row into a planned Expense, so it leaves this
			// derived view and appears in the Planned transaction list.
			void utils.transaction.unplanned.invalidate();
			void utils.transaction.list.invalidate();
			// Linking sets the row's expenseId, adding it to that expense's consumed
			// total on the Planned page.
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

	// Managed order (`category.list` arrives sorted), then "No category" last.
	// An id this tab's list doesn't know yet joins "No category" rather than vanish.
	const groups = useMemo(() => {
		const known = new Set(categories.map((c) => c.id));
		const byId = new Map<number | null, UnplannedRow[]>();
		for (const row of rows ?? []) {
			const id =
				row.categoryId !== null && known.has(row.categoryId)
					? row.categoryId
					: null;
			const arr = byId.get(id) ?? [];
			arr.push(row);
			byId.set(id, arr);
		}
		const filed = categories.flatMap((c) => {
			const grouped = byId.get(c.id);
			return grouped
				? [{ key: String(c.id), label: c.name, rows: grouped }]
				: [];
		});
		const unfiled = byId.get(null);
		return unfiled
			? [...filed, { key: "none", label: "No category", rows: unfiled }]
			: filed;
	}, [rows, categories]);

	function selectKind(next: PeriodKind) {
		// Re-clicking the active length would reset the window back to today,
		// discarding the user's prev/next navigation — only act on a real change.
		if (next === kind) return;
		setKind(next);
		setRange(
			next === "fortnight" && anchorDate
				? fortnightWindow(anchorDate, new Date())
				: monthWindow(new Date()),
		);
	}

	function step(direction: 1 | -1) {
		setRange((r) => (r ? shiftWindow(r, kind, direction) : r));
	}

	const isLoading = rows === undefined && !isError;

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="Spend not yet linked to a planned expense. Link a transaction to move it out of here."
				title="Unplanned"
			/>

			<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<Button
						aria-label="Previous period"
						disabled={!range}
						onClick={() => step(-1)}
						size="icon-sm"
						variant="outline"
					>
						<ChevronLeft />
					</Button>
					<span
						aria-atomic="true"
						aria-live="polite"
						className="tabular min-w-44 text-center font-medium text-foreground text-sm"
					>
						{range ? periodLabel(kind, range) : "…"}
					</span>
					<Button
						aria-label="Next period"
						disabled={!range}
						onClick={() => step(1)}
						size="icon-sm"
						variant="outline"
					>
						<ChevronRight />
					</Button>
				</div>
				{anchorDate && (
					<fieldset className="flex gap-1">
						<legend className="sr-only">Period length</legend>
						{(["fortnight", "month"] as const).map((k) => (
							<Button
								aria-pressed={kind === k}
								key={k}
								onClick={() => selectKind(k)}
								size="sm"
								variant={kind === k ? "secondary" : "ghost"}
							>
								{k === "fortnight" ? "Fortnight" : "Month"}
							</Button>
						))}
					</fieldset>
				)}
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{/* Above the groups, not gated on emptiness: placeholderData keeps the
				    prior window's rows on a failed refetch, so a groups-length gate
				    would hide the failure behind stale data. Kept at full opacity — only
				    the stale rows below dim on refetch, never the error/recovery card. */}
				{isError && (
					<Card
						className="text-center [--card-spacing:--spacing(10)]"
						role="alert"
					>
						<CardContent className="flex flex-col items-center gap-3">
							<p className="text-muted-foreground text-sm">
								Couldn't load the latest unplanned Spend.
							</p>
							<Button
								onClick={() => void refetch()}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</CardContent>
					</Card>
				)}

				<div
					className={cn(
						"flex flex-col gap-6 transition-opacity",
						isFetching && "opacity-60",
					)}
				>
					{groups.map(({ key, label, rows: rowsInGroup }) => {
						const groupTotal = rowsInGroup.reduce((s, r) => s + r.amount, 0);
						return (
							<Card className="[--card-spacing:0px]" key={key}>
								{/* Mirror the row grid so the group total sits in the same
							    column as the amounts it sums (col 3); the picker column
							    (col 4) stays empty. */}
								<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3 sm:grid sm:grid-cols-[7rem_1fr_7rem_14rem] sm:gap-3">
									<span className="flex items-center gap-2 sm:col-span-2">
										<span className="font-semibold text-foreground text-sm">
											{label}
										</span>
										<span className="text-muted-foreground text-xs">
											({rowsInGroup.length})
										</span>
									</span>
									<Money
										className="font-medium text-sm sm:text-right"
										signed
										tone="ledger"
										value={groupTotal}
									/>
								</div>
								<div className="divide-y divide-border">
									{rowsInGroup.map((row) => (
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
												// Gate only the row whose link is in flight. The
												// mutation is shared, so `link.isPending` alone would
												// freeze every row's picker on any single link.
												disabled={
													link.isPending && link.variables?.id === row.id
												}
												items={expenseOptions}
												onValueChange={(v) => {
													if (v)
														link.mutate({ id: row.id, expenseId: Number(v) });
												}}
												placeholder="Link to expense…"
												value={null}
											/>
										</div>
									))}
								</div>
							</Card>
						);
					})}
				</div>

				{isLoading && (
					<Card
						className="text-center [--card-spacing:--spacing(10)]"
						role="status"
					>
						<CardContent>
							<p className="text-muted-foreground text-sm">
								Loading unplanned Spend…
							</p>
						</CardContent>
					</Card>
				)}
				{!isLoading && !isError && groups.length === 0 && (
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
			</div>
		</div>
	);
}
