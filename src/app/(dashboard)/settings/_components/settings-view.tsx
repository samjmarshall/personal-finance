"use client";

import { AtSign, CalendarClock, type LucideIcon, Palette } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PageHeader } from "~/components/page-header";
import { cn } from "~/lib/utils";
import { AllowedSendersSection } from "./allowed-senders-section";
import { AppearanceSection } from "./appearance-section";
import { PayCycleSection } from "./pay-cycle-section";

export type SettingsViewProps = {
	/** Undefined when RESEND_INBOUND_ADDRESS is unset; the panel then omits it. */
	inboundAddress?: string;
};

type SectionId = "appearance" | "pay-cycle" | "forwarding";

// `render` rather than a bare component: this file is a client boundary, so a
// server-only value like the inbound address can only arrive as a prop from the
// RSC. Each entry picks the props it needs instead of every section having to
// accept the whole bag (adr001 — explicit named props, no Provider).
type Section = {
	id: SectionId;
	label: string;
	icon: LucideIcon;
	render: (props: SettingsViewProps) => ReactNode;
};

const sections: Section[] = [
	{
		id: "appearance",
		label: "Appearance",
		icon: Palette,
		render: () => <AppearanceSection />,
	},
	{
		id: "pay-cycle",
		label: "Pay cycle",
		icon: CalendarClock,
		render: () => <PayCycleSection />,
	},
	{
		id: "forwarding",
		label: "Forwarding",
		icon: AtSign,
		render: ({ inboundAddress }) => (
			<AllowedSendersSection inboundAddress={inboundAddress} />
		),
	},
];

export function SettingsView({ inboundAddress }: SettingsViewProps) {
	const [active, setActive] = useState<SectionId>("appearance");
	const navRef = useRef<HTMLElement | null>(null);

	// The rail is a horizontally scrolling strip on narrow screens, wide enough to
	// overflow once there are three tabs, so the active tab can sit past the edge
	// and render half-clipped — which reads as broken.
	//
	// Explicit maths rather than scrollIntoView: `inline: "nearest"` leaves a tab
	// that overhangs the right edge unscrolled in Chromium, and "start"/"end"/
	// "center" all move the rail even when the tab is already fully visible.
	useEffect(() => {
		const nav = navRef.current;
		const tab = nav?.querySelector<HTMLElement>(`[data-section="${active}"]`);
		if (!nav || !tab) return;

		const overhang =
			tab.offsetLeft + tab.offsetWidth - (nav.scrollLeft + nav.clientWidth);
		if (overhang > 0) nav.scrollLeft += overhang;
		else if (tab.offsetLeft < nav.scrollLeft) nav.scrollLeft = tab.offsetLeft;
	}, [active]);

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="How Ledger looks, how your pay cycle is counted, and where receipts can arrive from."
				title="Settings"
			/>

			<div className="mt-8 grid gap-6 lg:grid-cols-[184px_1fr] lg:gap-10">
				{/* One rail, two shapes: an underlined strip on narrow screens, a sticky
				    vertical index once there's a column to spare. */}
				<nav
					aria-label="Settings sections"
					className="flex gap-1 overflow-x-auto border-border border-b lg:sticky lg:top-8 lg:h-fit lg:flex-col lg:border-b-0 lg:border-l"
					ref={navRef}
				>
					{sections.map(({ id, label, icon: Icon }) => (
						<button
							aria-pressed={active === id}
							className={cn(
								"-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 font-medium text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 lg:mb-0 lg:-ml-px lg:border-b-0 lg:border-l-2 lg:py-1.5 lg:pl-4",
								active === id
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
							data-section={id}
							key={id}
							onClick={() => setActive(id)}
							type="button"
						>
							<Icon className="h-4 w-4" />
							{label}
						</button>
					))}
				</nav>

				{/* Every section stays mounted and the inactive ones are hidden —
				    unmounting would silently bin a half-typed anchor or address when a
				    member flicks to Appearance and back. The suspending queries are
				    covered by the page prefetch, same as every other view. */}
				{sections.map(({ id, render }) => (
					<div hidden={active !== id} key={id}>
						{render({ inboundAddress })}
					</div>
				))}
			</div>
		</div>
	);
}
