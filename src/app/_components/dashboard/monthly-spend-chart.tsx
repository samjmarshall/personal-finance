import { formatCompact, formatCurrency, formatMonthKey } from "~/lib/utils";

export function MonthlySpendChart({
	data,
}: {
	data: { month: string; total: number }[];
}) {
	if (!data.length) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				No spending recorded yet.
			</p>
		);
	}

	const max = Math.max(...data.map((d) => d.total), 1);

	return (
		<div className="flex h-56 items-stretch gap-2">
			{data.map((d) => {
				const heightPct = Math.max((d.total / max) * 100, 1.5);
				return (
					<div
						className="group flex flex-1 flex-col items-center justify-end gap-2"
						key={d.month}
					>
						<div className="relative flex w-full flex-1 items-end">
							<div
								className="w-full rounded-t-md bg-primary/85 transition-colors group-hover:bg-primary"
								style={{ height: `${heightPct}%` }}
							>
								<span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-medium text-[10px] text-background opacity-0 transition-opacity group-hover:opacity-100">
									{formatCurrency(d.total)}
								</span>
							</div>
						</div>
						<span className="font-medium text-[10px] text-muted-foreground">
							{formatMonthKey(d.month).split(" ")[0]}
						</span>
						<span className="tabular text-[10px] text-muted-foreground/70">
							{formatCompact(d.total)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
