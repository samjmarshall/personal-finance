import { Money } from "~/app/_components/ui/money";

export function TopCategories({
	data,
}: {
	data: { category: string; total: number; count: number }[];
}) {
	const rows = data.filter((d) => d.total > 0);
	if (!rows.length) {
		return (
			<p className="py-6 text-center text-sm text-muted-foreground">
				No categories to show yet.
			</p>
		);
	}
	const max = Math.max(...rows.map((r) => r.total), 1);

	return (
		<div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
			{rows.map((row) => (
				<div key={row.category} className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between gap-3 text-sm">
						<span className="truncate font-medium text-foreground">
							{row.category}
						</span>
						<Money
							value={row.total}
							className="shrink-0 text-sm font-medium text-foreground"
						/>
					</div>
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary/70"
							style={{ width: `${Math.max((row.total / max) * 100, 2)}%` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}
