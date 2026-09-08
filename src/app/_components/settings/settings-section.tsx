"use client";

import { type ReactNode, useId } from "react";

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
	// Names the landmark, so a screen reader's region list says "Forwarding
	// addresses" rather than offering three anonymous sections.
	const headingId = useId();

	return (
		<section aria-labelledby={headingId}>
			<h2
				className="font-semibold text-base text-foreground tracking-tight"
				id={headingId}
			>
				{title}
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">{description}</p>
			{children}
		</section>
	);
}
