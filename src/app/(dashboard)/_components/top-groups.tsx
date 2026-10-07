import { Money } from "~/components/money";

export function TopGroups({
	data,
}: {
	data: { group: string; total: number; count: number }[];
}) {
	const rows = data.filter((d) => d.total > 0);
	if (!rows.length) {
		return (
			<p className="py-6 text-center text-muted-foreground text-sm">
				No groups to show yet.
			</p>
		);
	}
	const max = Math.max(...rows.map((r) => r.total), 1);

	return (
		<div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
			{rows.map((row) => (
				<div className="flex flex-col gap-1.5" key={row.group}>
					<div className="flex items-center justify-between gap-3 text-sm">
						<span className="truncate font-medium text-foreground">
							{row.group}
						</span>
						<Money
							className="shrink-0 font-medium text-foreground text-sm"
							value={row.total}
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
