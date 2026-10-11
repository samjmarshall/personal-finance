import type { ReactNode } from "react";

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 border-border border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 className="text-balance font-semibold text-2xl text-foreground tracking-tight">
					{title}
				</h1>
				{description && (
					<div className="mt-1 text-pretty text-muted-foreground text-sm">
						{description}
					</div>
				)}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
