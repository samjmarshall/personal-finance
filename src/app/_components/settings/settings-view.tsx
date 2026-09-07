"use client";

import { CalendarClock, Palette } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "~/app/_components/page-header";
import { cn } from "~/lib/utils";
import { AppearanceSection } from "./appearance-section";
import { PayCycleSection } from "./pay-cycle-section";

const sections = [
	{
		id: "appearance",
		label: "Appearance",
		icon: Palette,
		Component: AppearanceSection,
	},
	{
		id: "pay-cycle",
		label: "Pay cycle",
		icon: CalendarClock,
		Component: PayCycleSection,
	},
] as const;

type SectionId = (typeof sections)[number]["id"];

export function SettingsView() {
	const [active, setActive] = useState<SectionId>("appearance");

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="How Ledger looks, and how your pay cycle is counted."
				title="Settings"
			/>

			<div className="mt-8 grid gap-6 lg:grid-cols-[184px_1fr] lg:gap-10">
				{/* One rail, two shapes: an underlined strip on narrow screens, a sticky
				    vertical index once there's a column to spare. */}
				<nav
					aria-label="Settings sections"
					className="flex gap-1 overflow-x-auto border-border border-b lg:sticky lg:top-8 lg:h-fit lg:flex-col lg:border-b-0 lg:border-l"
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
							key={id}
							onClick={() => setActive(id)}
							type="button"
						>
							<Icon className="h-4 w-4" />
							{label}
						</button>
					))}
				</nav>

				{/* Both sections stay mounted and the inactive one is hidden — unmounting
				    it would silently bin a half-typed anchor when a member flicks to
				    Appearance and back. Pay cycle's suspending query is covered by the
				    page prefetch, same as every other view. */}
				{sections.map(({ id, Component }) => (
					<div hidden={active !== id} key={id}>
						<Component />
					</div>
				))}
			</div>
		</div>
	);
}
