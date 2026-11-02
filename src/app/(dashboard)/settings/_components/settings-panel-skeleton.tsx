import type { ReactNode } from "react";
import { ErrorSlot } from "~/components/skeletons";
import { Skeleton } from "~/components/ui/skeleton";

/** A data panel's real heading over bars, flat like the panel itself. */
function SettingsPanelSkeleton({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div>
			{/* Shows through if the panel fails; the error card lands under it. */}
			<div className="visible">
				<h2 className="text-base font-semibold tracking-tight text-foreground">
					{title}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<ErrorSlot className="mt-5">{children}</ErrorSlot>
		</div>
	);
}

/** Label over an input + button row, like each panel's form. */
function FieldSkeleton() {
	return (
		<div className="flex max-w-sm flex-col gap-2">
			<Skeleton className="my-0.5 h-4 w-28" />
			<div className="flex gap-2">
				<Skeleton className="h-8 flex-1 rounded-lg" />
				<Skeleton className="h-8 w-14 rounded-lg" />
			</div>
		</div>
	);
}

export function PayCycleSkeleton() {
	return (
		<SettingsPanelSkeleton
			description="The payday your fortnight buckets are counted from. Cash flow groups every fortnight forward and back from this date."
			title="Pay cycle"
		>
			<FieldSkeleton />
		</SettingsPanelSkeleton>
	);
}

export function ForwardingSkeleton({
	hasInboundAddress,
}: {
	hasInboundAddress: boolean;
}) {
	return (
		<SettingsPanelSkeleton
			description="Receipts are only ingested from these addresses. Mail forwarded from anywhere else is dropped."
			title="Forwarding addresses"
		>
			{/* Flex boxes here and below, so the bars' margins add up instead of
			    collapsing. */}
			{hasInboundAddress && (
				<div className="mb-5 flex flex-col rounded-md border border-border px-3 py-2.5">
					<Skeleton className="my-0.5 h-3 w-28" />
					<Skeleton className="mt-1 mb-0.5 h-4 w-64 max-w-full" />
				</div>
			)}
			<FieldSkeleton />
			<div className="mt-6 divide-y divide-border rounded-md border border-border">
				{["w-48", "w-40"].map((width) => (
					<div className="flex flex-col px-3 py-2.5" key={width}>
						<Skeleton className={`my-0.5 h-4 ${width}`} />
						<Skeleton className="my-0.5 h-3 w-32" />
					</div>
				))}
			</div>
		</SettingsPanelSkeleton>
	);
}

export function BankAccountsSkeleton() {
	return (
		<SettingsPanelSkeleton
			description="Your cash balance adds up every account switched on. Switched-off accounts still sync, they just aren't counted."
			title="Cash balance"
		>
			{/* One bank group, then the Total, in BankAccountsSection's boxes. */}
			<div className="flex items-baseline justify-between px-1 pb-2">
				<Skeleton className="my-0.5 h-4 w-24" />
				<Skeleton className="my-0.5 h-3 w-20" />
			</div>
			<div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
				{["w-36", "w-44", "w-28"].map((width) => (
					<div className="flex items-center gap-3 px-3 py-2.5" key={width}>
						<div className="flex min-w-0 flex-1 flex-col">
							<Skeleton className={`my-0.5 h-4 ${width} max-w-full`} />
							<Skeleton className="my-0.5 h-3 w-16" />
						</div>
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-[18.4px] w-8 rounded-full" />
					</div>
				))}
			</div>
			<div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
				<div className="flex min-w-0 flex-1 flex-col">
					<Skeleton className="my-0.5 h-4 w-10" />
					<Skeleton className="my-0.5 h-3 w-36 max-w-full" />
				</div>
				<Skeleton className="h-4 w-20" />
				<span aria-hidden="true" className="w-8 shrink-0" />
			</div>
		</SettingsPanelSkeleton>
	);
}
