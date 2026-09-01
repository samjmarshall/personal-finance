"use client";

import { Suspense, useState } from "react";
import {
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	Line,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";

import { SelectField } from "~/app/_components/select-field";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
} from "~/components/ui/chart";
import type { PeriodKind } from "~/lib/period";
import { cn, formatCompact, formatCurrency } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

const PERIOD_OPTIONS = [
	{ value: "fortnight" as const, label: "Fortnight" },
	{ value: "month" as const, label: "Month" },
];

const chartConfig = {
	inflow: { label: "Inflow", color: "var(--color-positive)" },
	// Reference the base --spend token, not --color-spend: the config key "spend"
	// makes ChartStyle emit `--color-spend: var(--color-spend)`, a self-reference
	// that's invalid at computed-value time (bars would fall back to black).
	spend: { label: "Spend", color: "var(--spend)" },
	balance: { label: "Balance", color: "var(--color-foreground)" },
} satisfies ChartConfig;

type Bucket = RouterOutputs["cashflow"]["get"]["buckets"][number];

// One row per bucket. Spend is negated so the bar draws below the y=0 baseline —
// Recharts diverges around zero automatically (inflow up, spend down).
type ChartRow = {
	key: string;
	label: string;
	inflow: number;
	spend: number;
	balance: number | null;
	belowZero: boolean;
	items: Bucket["items"];
};

export function CashFlowChart() {
	const [periodKind, setPeriodKind] = useState<PeriodKind>("fortnight");

	return (
		<div>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="font-semibold text-foreground text-sm">Cash flow</h2>
					<p className="text-muted-foreground text-xs">
						Recorded flow, then a forward projection of commitments
					</p>
				</div>
				<SelectField
					aria-label="Chart period"
					className="w-32"
					items={PERIOD_OPTIONS}
					onValueChange={(v) => v && setPeriodKind(v)}
					value={periodKind}
				/>
			</div>
			{/* Toggling periodKind re-suspends only the chart body, so the toggle
			    stays interactive while the new grid loads. */}
			<Suspense
				fallback={
					<div className="h-72 w-full animate-pulse rounded-lg bg-muted/50" />
				}
			>
				<CashFlowChartBody periodKind={periodKind} />
			</Suspense>
		</div>
	);
}

function CashFlowChartBody({ periodKind }: { periodKind: PeriodKind }) {
	const [data] = api.cashflow.get.useSuspenseQuery({ periodKind });

	const hasFlow = data.buckets.some((b) => b.spend > 0 || b.inflow > 0);
	if (!hasFlow && !data.hasBalanceAnchor) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				No cash flow to project yet.
			</p>
		);
	}

	const rows: ChartRow[] = data.buckets.map((b) => ({
		key: b.key,
		label: b.label,
		inflow: b.inflow,
		spend: -b.spend,
		balance: b.balance,
		belowZero: b.balance != null && b.balance < 0,
		items: b.items,
	}));
	const labelFor = new Map(rows.map((r) => [r.key, r.label]));
	const currentKey = data.buckets.find((b) => b.isCurrent)?.key;

	return (
		<div>
			<div className="mb-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-[2px] bg-positive" />
					Inflow
				</span>
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-[2px] bg-spend" />
					Spend
				</span>
				{data.hasBalanceAnchor && (
					<span className="flex items-center gap-1.5">
						<span className="h-0.5 w-3 bg-foreground" />
						Balance
					</span>
				)}
			</div>

			<ChartContainer className="h-72 w-full" config={chartConfig}>
				<ComposedChart
					data={rows}
					margin={{ top: 12, right: 4, bottom: 4, left: 4 }}
				>
					<CartesianGrid strokeDasharray="3 3" vertical={false} />
					<XAxis
						axisLine={false}
						dataKey="key"
						interval="preserveStartEnd"
						minTickGap={16}
						tick={{ fontSize: 11 }}
						tickFormatter={(k: string) => labelFor.get(k) ?? k}
						tickLine={false}
					/>
					<YAxis
						axisLine={false}
						tick={{ fontSize: 11 }}
						tickFormatter={(v: number) => formatCompact(Math.abs(v))}
						tickLine={false}
						width={48}
						yAxisId="left"
					/>
					{data.hasBalanceAnchor && (
						<YAxis
							axisLine={false}
							orientation="right"
							tick={{ fontSize: 11 }}
							tickFormatter={(v: number) => formatCompact(v)}
							tickLine={false}
							width={48}
							yAxisId="right"
						/>
					)}
					<ReferenceLine stroke="var(--color-border)" y={0} yAxisId="left" />
					{currentKey && (
						<ReferenceLine
							label={{
								fill: "var(--color-primary)",
								fontSize: 11,
								position: "top",
								value: "Today",
							}}
							stroke="var(--color-primary)"
							strokeDasharray="4 3"
							x={currentKey}
							yAxisId="left"
						/>
					)}
					<ChartTooltip
						content={({ active, payload }) => (
							<CashFlowTooltip
								active={active}
								row={payload?.[0]?.payload as ChartRow | undefined}
							/>
						)}
						cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
					/>
					{/* Inflow always reads positive — never recolored, so a below-zero
					    bucket doesn't paint the income bar as a warning. */}
					<Bar
						dataKey="inflow"
						fill="var(--color-inflow)"
						radius={[3, 3, 0, 0]}
						yAxisId="left"
					/>
					{/* Tint only the Spend bar when the bucket's projected balance dips
					    below zero — the warning is about money going out. */}
					<Bar dataKey="spend" radius={[0, 0, 3, 3]} yAxisId="left">
						{rows.map((r) => (
							<Cell
								fill={
									r.belowZero ? "var(--color-warning)" : "var(--color-spend)"
								}
								key={r.key}
							/>
						))}
					</Bar>
					{data.hasBalanceAnchor && (
						<Line
							dataKey="balance"
							dot={false}
							stroke="var(--color-balance)"
							strokeWidth={2}
							type="monotone"
							yAxisId="right"
						/>
					)}
				</ComposedChart>
			</ChartContainer>
		</div>
	);
}

function CashFlowTooltip({
	active,
	row,
}: {
	active?: boolean;
	row?: ChartRow;
}) {
	if (!active || !row) return null;
	const spend = Math.abs(row.spend);

	// Label+amount can repeat within one bucket (two "Rent" at $600); a per-bucket
	// occurrence suffix keeps each row's React key unique without an array index.
	const seen = new Map<string, number>();
	const items = row.items.map((it) => {
		const base = `${it.label}:${it.amount}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return { ...it, key: n ? `${base}#${n}` : base };
	});

	return (
		<div className="min-w-44 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
			<p className="font-medium text-foreground">{row.label}</p>
			<div className="mt-1.5 grid gap-1">
				{row.inflow > 0 && (
					<div className="flex justify-between gap-4">
						<span className="text-muted-foreground">Inflow</span>
						<span className="tabular text-positive">
							{formatCurrency(row.inflow)}
						</span>
					</div>
				)}
				{spend > 0 && (
					<div className="flex justify-between gap-4">
						<span className="text-muted-foreground">Spend</span>
						<span className="tabular text-spend">{formatCurrency(spend)}</span>
					</div>
				)}
				{row.balance != null && (
					<div className="flex justify-between gap-4 border-border/50 border-t pt-1">
						<span className="text-muted-foreground">Balance</span>
						<span className="tabular font-medium text-foreground">
							{formatCurrency(row.balance)}
						</span>
					</div>
				)}
			</div>
			{items.length > 0 && (
				<div className="mt-2 border-border/50 border-t pt-1.5">
					<p className="mb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
						Projected
					</p>
					{/* Cap height + scroll: a busy bucket (many projected items) would
					    otherwise grow the tooltip past the card and cover the page. */}
					<div className="grid max-h-[280px] gap-0.5 overflow-y-auto">
						{items.map((it) => (
							<div className="flex justify-between gap-4" key={it.key}>
								<span className="text-muted-foreground">{it.label}</span>
								{/* item.amount is signed: + Spend, − Inflow. Show the direction
								    as a sign too, not color alone — spend "−", inflow "+"
								    (WCAG 1.4.1: color isn't the only cue). */}
								<span
									className={cn(
										"tabular",
										it.amount >= 0 ? "text-spend" : "text-positive",
									)}
								>
									{it.amount >= 0 ? "−" : "+"}
									{formatCurrency(Math.abs(it.amount))}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
