import type { ReactNode } from "react";

/** Heading + blurb shell shared by every panel on /settings; mirrors PageHeader one
 *  level down. */
export function SettingsSection({
	title,
	description,
	children,
}: {
	title: string;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<section>
			<h2 className="font-semibold text-base text-foreground tracking-tight">
				{title}
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">{description}</p>
			{children}
		</section>
	);
}
