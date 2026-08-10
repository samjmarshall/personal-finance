import { priorityStyle } from "~/lib/constants";
import { Money } from "~/app/_components/ui/money";

export function PriorityBreakdown({
	data,
	total,
}: {
	data: { priority: string; total: number; count: number }[];
	total: number;
}) {
	const rows = [...data]
		.filter((d) => d.total > 0)
		.sort((a, b) => b.total - a.total);

	if (!rows.length) {
		return (
			<p className="py-6 text-center text-sm text-muted-foreground">
				No spend to break down yet.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{rows.map((row) => {
				const pct = total > 0 ? Math.round((row.total / total) * 100) : 0;
				const style = priorityStyle(row.priority);
				return (
					<div key={row.priority} className="flex flex-col gap-1.5">
						<div className="flex items-center justify-between text-sm">
							<span className="flex items-center gap-2 font-medium text-foreground">
								<span className={`h-2 w-2 rounded-full ${style.dot}`} />
								{style.label}
							</span>
							<Money
								value={row.total}
								className="text-sm font-medium text-foreground"
							/>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className={`h-full rounded-full ${style.dot}`}
								style={{ width: `${Math.max(pct, 1)}%` }}
							/>
						</div>
						<span className="text-xs text-muted-foreground">
							{pct}% · {row.count} transactions
						</span>
					</div>
				);
			})}
		</div>
	);
}
