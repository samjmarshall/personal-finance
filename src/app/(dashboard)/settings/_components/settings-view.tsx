"use client";

import {
	AtSign,
	CalendarClock,
	Landmark,
	type LucideIcon,
	Palette,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { AsyncBoundary } from "~/components/async-boundary";
import { PageHeader } from "~/components/page-header";
import { cn } from "~/lib/utils";
import { AllowedSendersSection } from "./allowed-senders-section";
import { AppearanceSection } from "./appearance-section";
import { BankAccountsSection } from "./bank-accounts-section";
import { PayCycleSection } from "./pay-cycle-section";
import {
	BankAccountsSkeleton,
	ForwardingSkeleton,
	PayCycleSkeleton,
} from "./settings-panel-skeleton";

export type SettingsViewProps = {
	/** Undefined when RESEND_INBOUND_ADDRESS is unset; the panel then omits it. */
	inboundAddress?: string;
};

type SectionId = "appearance" | "pay-cycle" | "forwarding" | "bank-accounts";

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
		render: () => (
			<AsyncBoundary label="pay cycle" skeleton={<PayCycleSkeleton />}>
				<PayCycleSection />
			</AsyncBoundary>
		),
	},
	{
		id: "forwarding",
		label: "Forwarding",
		icon: AtSign,
		render: ({ inboundAddress }) => (
			<AsyncBoundary
				label="allowed senders"
				skeleton={<ForwardingSkeleton hasInboundAddress={!!inboundAddress} />}
			>
				<AllowedSendersSection inboundAddress={inboundAddress} />
			</AsyncBoundary>
		),
	},
	{
		id: "bank-accounts",
		label: "Bank accounts",
		icon: Landmark,
		render: () => (
			<AsyncBoundary label="bank accounts" skeleton={<BankAccountsSkeleton />}>
				<BankAccountsSection />
			</AsyncBoundary>
		),
	},
];

export function SettingsView({ inboundAddress }: SettingsViewProps) {
	const [active, setActive] = useState<SectionId>("appearance");

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="How Ledger looks, how your pay cycle is counted, where receipts can arrive from, and which bank accounts count."
				title="Settings"
			/>

			<div className="mt-8 grid gap-6 lg:grid-cols-[184px_1fr] lg:gap-10">
				{/* One rail, two shapes: an underlined strip on narrow screens, a sticky
				    vertical index once there's a column to spare. The strip wraps on a
				    phone, so no tab hides past the edge. */}
				<nav
					aria-label="Settings sections"
					className="flex flex-wrap gap-1 border-border border-b lg:sticky lg:top-8 lg:h-fit lg:flex-col lg:border-b-0 lg:border-l"
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

				{/* All stay mounted, so half-typed input survives a tab switch. Each data
				    panel has its own boundary: one failing leaves the rest usable. */}
				{sections.map(({ id, render }) => (
					<div hidden={active !== id} key={id}>
						{render({ inboundAddress })}
					</div>
				))}
			</div>
		</div>
	);
}
