import { PageSkeleton } from "~/components/page-skeleton";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

// One per page, shared by its page-level AsyncBoundary and the group's
// loading.tsx, so a nav and a hard load show the same frame. Headers repeat each
// view's PageHeader; bodies follow its markup.

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
		/>
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
							<Skeleton className="size-4" />
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
		<PageSkeleton action className="max-w-6xl" title="Transaction History" />
	);
}

export function ReceiptsSkeleton() {
	return (
		<PageSkeleton
			action
			className="max-w-6xl"
			description="Upload a photo or PDF; we extract the vendor, total and line items."
			title="Receipts"
		/>
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
				<div className="flex gap-1 border-border border-b lg:flex-col lg:border-b-0 lg:border-l">
					{["w-24", "w-20", "w-24"].map((width) => (
						<div
							className="-mb-px border-transparent border-b-2 px-3 py-2 lg:mb-0 lg:-ml-px lg:border-b-0 lg:border-l-2 lg:py-1.5 lg:pl-4"
							key={width}
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

/** Per fortnight / month / year totals. */
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

/** A named group's card: header, column labels, then rows on the views' grid. */
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
