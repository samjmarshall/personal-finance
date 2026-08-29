"use client";

import { skipToken } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Money } from "~/app/_components/money";
import { PageHeader } from "~/app/_components/page-header";
import { SelectField } from "~/app/_components/select-field";
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
	const { data: categories } = api.category.list.useQuery();

	const anchorDate = anchor ? fromDateInput(anchor) : null;

	// Fortnight needs the anchor to seed its grid; without one the picker is
	// month-only (design: degrade, never error).
	const [kind, setKind] = useState<PeriodKind>(
		anchorDate ? "fortnight" : "month",
	);
	// Seed the window from "today" only after mount. new Date() resolves to a
	// different calendar day on the server (UTC) than in the browser (local
	// tz), so computing it during render would mismatch hydration at a day
	// boundary. Effects don't run server-side: the first client render matches
	// the server's null window, then this fills it in.
	const [range, setRange] = useState<PeriodWindow | null>(null);
	useEffect(() => {
		const seed = anchor ? fromDateInput(anchor) : null;
		setRange(
			seed ? fortnightWindow(seed, new Date()) : monthWindow(new Date()),
		);
	}, [anchor]);

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
		},
	});

	const expenseOptions = useMemo(
		() => [
			{ value: "", label: "Link to expense…" },
			...expenses.map((e) => ({ value: String(e.id), label: e.name })),
		],
		[expenses],
	);

	const groups = useMemo(() => {
		const map = new Map<string, UnplannedRow[]>();
		for (const row of rows ?? []) {
			const arr = map.get(row.category) ?? [];
			arr.push(row);
			map.set(row.category, arr);
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
	}, [rows, categories]);

	function selectKind(next: PeriodKind) {
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
					<span className="tabular min-w-44 text-center font-medium text-foreground text-sm">
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
					<fieldset aria-label="Period length" className="flex gap-1">
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

			<div
				className={cn(
					"mt-6 flex flex-col gap-6 transition-opacity",
					isFetching && "opacity-60",
				)}
			>
				{groups.map(([category, rowsInGroup]) => {
					const groupTotal = rowsInGroup.reduce((s, r) => s + r.amount, 0);
					return (
						<Card className="[--card-spacing:0px]" key={category}>
							<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3">
								<span className="flex items-center gap-2">
									<span className="font-semibold text-foreground text-sm">
										{category}
									</span>
									<span className="text-muted-foreground text-xs">
										({rowsInGroup.length})
									</span>
								</span>
								<Money
									className="font-medium text-sm"
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
											items={expenseOptions}
											onValueChange={(v) => {
												if (v)
													link.mutate({ id: row.id, expenseId: Number(v) });
											}}
											value=""
										/>
									</div>
								))}
							</div>
						</Card>
					);
				})}

				{isError && groups.length === 0 && (
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent className="flex flex-col items-center gap-3">
							<p className="text-muted-foreground text-sm">
								Couldn't load unplanned Spend.
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
				{isLoading && groups.length === 0 && (
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent>
							<p className="text-muted-foreground text-sm">
								Loading unplanned Spend…
							</p>
						</CardContent>
					</Card>
				)}
				{!isLoading && !isError && groups.length === 0 && (
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent>
							<p className="text-muted-foreground text-sm">
								All Spend in this period is linked to a planned expense.
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
