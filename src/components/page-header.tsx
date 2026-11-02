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
		<div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
					{title}
				</h1>
				{description && (
					<div className="mt-1 text-sm text-pretty text-muted-foreground">
						{description}
					</div>
				)}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
