import { PageSkeleton } from "~/components/page-skeleton";
import { TableSkeleton } from "~/components/skeletons";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

// One per page: loading.tsx draws it on nav, the page's boundary (if any) on hard
// load, so both paint one frame. Headers and bodies copy each view's markup.

const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

export function OverviewSkeleton() {
	return (
		<PageSkeleton
			className="max-w-6xl"
			description="A snapshot of your household budget and spending."
			title="Overview"
		>
			{/* The page is sync, so its own section skeletons follow straight away. */}
			{null}
		</PageSkeleton>
	);
}

export function ExpensesSkeleton() {
	return (
		<PageSkeleton
			action
			description="Your budgeted outgoings, split by cadence."
			title="Expenses"
		>
			{/* Recurring / One-time tabs */}
			<Skeleton className="h-10 w-64 rounded-full" />
			<StatTilesSkeleton className="mt-6" />
			<div className="mt-6 flex flex-col gap-4">
				<GroupCardSkeleton rows={4} />
				<GroupCardSkeleton rows={2} />
			</div>
		</PageSkeleton>
	);
}

export function UnplannedSkeleton() {
	return (
		<PageSkeleton
			description="Spend not yet linked to a planned expense. Link a transaction to move it out of here."
			title="Unplanned"
		>
			{/* Period controls. Draws the length toggle, which shows only with a
			    fortnight anchor; without one a phone lands a row shorter. */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<Skeleton className="size-7" />
					<div className="flex h-5 min-w-44 justify-center">
						<Skeleton className="my-0.5 h-4 w-32" />
					</div>
					<Skeleton className="size-7" />
				</div>
				<div className="flex gap-1">
					<Skeleton className="h-7 w-20" />
					<Skeleton className="h-7 w-16" />
				</div>
			</div>
			<div className="mt-6">
				<UnplannedGroupsSkeleton />
			</div>
		</PageSkeleton>
	);
}

/** The view's grouped rows; also its table boundary's skeleton. */
export function UnplannedGroupsSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-6">
			{[3, 2].map((rows) => (
				<Card className="[--card-spacing:0px]" key={rows}>
					<div className="flex items-center justify-between gap-3 border-border border-b bg-muted/40 px-4 py-3">
						<Skeleton className="my-0.5 h-4 w-32" />
						<Skeleton className="my-0.5 h-4 w-16" />
					</div>
					<div className="divide-y divide-border">
						{indices(rows).map((row) => (
							<div
								className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[7rem_1fr_7rem_14rem] sm:items-center sm:gap-3"
								key={row}
							>
								<Skeleton className="my-0.5 h-4 w-20" />
								<Skeleton className="my-0.5 h-4 w-48 max-w-full" />
								<Skeleton className="my-0.5 h-4 w-16 sm:justify-self-end" />
								{/* Link picker */}
								<Skeleton className="h-8 w-full" />
							</div>
						))}
					</div>
				</Card>
			))}
		</div>
	);
}

export function CategoriesSkeleton() {
	return (
		<PageSkeleton
			action
			className="max-w-3xl"
			description="File Expenses, Transactions and receipt items under one shared list."
			title="Categories"
		>
			<div className="space-y-2">
				{indices(6).map((row) => (
					<Card key={row}>
						<CardContent className="flex items-center justify-between gap-4">
							{/* The real grip has a 1px focus border each side. */}
							<Skeleton className="mx-px size-4" />
							<div className="flex min-w-0 flex-1 items-center gap-2">
								<Skeleton className="h-4 w-28" />
								<Skeleton className="h-5 w-20 rounded-full" />
							</div>
							{/* Edit + delete buttons' room */}
							<div className="h-7 w-14 shrink-0" />
						</CardContent>
					</Card>
				))}
			</div>
		</PageSkeleton>
	);
}

export function IncomeSkeleton() {
	return (
		<PageSkeleton
			action
			description="Money coming in each fortnight, by person."
			title="Income"
		>
			<StatTilesSkeleton />
			<div className="mt-6 flex flex-col gap-6">
				<GroupCardSkeleton rows={1} />
				<GroupCardSkeleton rows={1} />
			</div>
		</PageSkeleton>
	);
}

export function TransactionsSkeleton() {
	// No description: it counts the rows, so it isn't known yet.
	return (
		<PageSkeleton action className="max-w-6xl" title="Transaction History">
			<Card>
				<CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
					{/* Search, then the priority and frequency filters */}
					<Skeleton className="h-8 sm:flex-1" />
					<div className="flex gap-2">
						<Skeleton className="h-8 w-36" />
						<Skeleton className="h-8 w-32" />
					</div>
				</CardContent>
			</Card>
			<div className="mt-4">
				<TransactionsTableSkeleton />
			</div>
		</PageSkeleton>
	);
}

/** The view's table and pager; also its table boundary's skeleton. */
export function TransactionsTableSkeleton() {
	return (
		<TableSkeleton
			footer={
				<div className="flex flex-col gap-3 border-border border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					{/* Page total, then "Page n of m" and the prev / next buttons */}
					<Skeleton className="my-0.5 h-4 w-36" />
					<div className="flex items-center gap-3">
						<Skeleton className="my-0.5 h-4 w-20" />
						<div className="flex gap-1">
							<Skeleton className="size-8" />
							<Skeleton className="size-8" />
						</div>
					</div>
				</div>
			}
		/>
	);
}

export function ReceiptsSkeleton() {
	return (
		<PageSkeleton
			// The upload button is default size, 4px taller than the others.
			action="default"
			className="max-w-6xl"
			description="Upload a photo or PDF; we extract the vendor, total and line items."
			title="Receipts"
		>
			<Card>
				{/* Status and match filters. Same widths, so they wrap like the real ones. */}
				<CardContent className="flex flex-wrap items-center gap-2">
					<Skeleton className="h-8 w-40" />
					<Skeleton className="h-8 w-52" />
				</CardContent>
			</Card>
			<div className="mt-4">
				<ReceiptsTableSkeleton />
			</div>
		</PageSkeleton>
	);
}

/** The view's table; also its table boundary's skeleton. */
export function ReceiptsTableSkeleton() {
	return (
		<Card aria-hidden className="[--card-spacing:0px]">
			<table className="w-full table-fixed border-collapse text-sm">
				<thead>
					<tr className="border-border border-b bg-muted/40">
						{/* Thumbnail column: the 40px image plus cell padding */}
						<th className="w-18 px-4 py-2.5" />
						{indices(4).map((col) => (
							<th className="px-4 py-2.5" key={col}>
								<Skeleton className="h-4 w-16 max-w-full" />
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{indices(8).map((row) => (
						<tr key={row}>
							<td className="px-4 py-2.5">
								<Skeleton className="size-10" />
							</td>
							{indices(4).map((col) => (
								<td className="px-4 py-3" key={col}>
									<Skeleton className="my-0.5 h-4 w-3/4" />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</Card>
	);
}

export function SettingsSkeleton() {
	return (
		<PageSkeleton
			contentClassName="mt-8"
			description="How Ledger looks, how your pay cycle is counted, and where receipts can arrive from."
			title="Settings"
		>
			<div className="grid gap-6 lg:grid-cols-[184px_1fr] lg:gap-10">
				<div className="flex gap-1 overflow-x-auto border-border border-b lg:h-fit lg:flex-col lg:border-b-0 lg:border-l">
					{[
						{ tab: "appearance", width: "w-24" },
						{ tab: "pay-cycle", width: "w-20" },
						{ tab: "forwarding", width: "w-24" },
					].map(({ tab, width }) => (
						<div
							className="-mb-px border-transparent border-b-2 px-3 py-2 lg:mb-0 lg:-ml-px lg:border-b-0 lg:border-l-2 lg:py-1.5 lg:pl-4"
							key={tab}
						>
							<Skeleton className={cn("my-0.5 h-4", width)} />
						</div>
					))}
				</div>
				{/* Appearance, the panel that opens first. Its text is fixed, so it's real
				    (the blurb as it reads before mount) and wraps like the page. */}
				<div>
					<h2 className="font-semibold text-base text-foreground tracking-tight">
						Appearance
					</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						Choose how Ledger looks — saved to this browser, not shared with
						your household.
					</p>
					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						{indices(3).map((tile) => (
							<div className="rounded-xl border border-border p-3" key={tile}>
								<Skeleton className="h-16 w-full rounded-lg" />
								<Skeleton className="mt-3.5 mb-0.5 h-4 w-20" />
							</div>
						))}
					</div>
				</div>
			</div>
		</PageSkeleton>
	);
}

function StatTilesSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-3", className)}>
			{indices(3).map((tile) => (
				<Card key={tile}>
					{/* Flex, so the bars' margins add up instead of collapsing. */}
					<CardContent className="flex flex-col">
						<Skeleton className="my-0.5 h-3 w-20" />
						<Skeleton className="mt-2.5 mb-1 h-5 w-28" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function GroupCardSkeleton({ rows }: { rows: number }) {
	const grid =
		"grid grid-cols-2 items-center gap-2 px-4 sm:grid-cols-[1fr_repeat(3,7rem)_3rem]";
	return (
		<Card className="[--card-spacing:0px]">
			<div className="flex items-center justify-between border-border border-b bg-muted/40 px-4 py-3">
				<Skeleton className="my-0.5 h-4 w-28" />
				<Skeleton className="h-3 w-16" />
			</div>
			<div className="divide-y divide-border">
				<div className={cn(grid, "hidden py-2 sm:grid")}>
					<Skeleton className="my-0.5 h-3 w-12" />
					{indices(3).map((col) => (
						<Skeleton className="my-0.5 h-3 w-14 justify-self-end" key={col} />
					))}
				</div>
				{indices(rows).map((row) => (
					<div className={cn(grid, "py-3")} key={row}>
						<Skeleton className="my-0.5 h-4 w-32" />
						<Skeleton className="my-0.5 hidden h-4 w-16 justify-self-end sm:block" />
						<Skeleton className="my-0.5 h-4 w-16 justify-self-end" />
						<Skeleton className="my-0.5 hidden h-4 w-16 justify-self-end sm:block" />
						{/* Edit + delete buttons' room */}
						<div className="h-6.5" />
					</div>
				))}
			</div>
		</Card>
	);
}
