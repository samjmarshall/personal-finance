import type { ReactNode } from "react";
import { PageHeader } from "~/components/page-header";
import { ErrorSlot, TableSkeleton } from "~/components/skeletons";
import { Skeleton, skeletonClassName } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

type PageSkeletonProps = {
	/** Omit for a generic page: the title becomes a bar. */
	title?: string;
	/** Omit when it holds live data: it becomes a bar. */
	description?: string;
	/** Reserves room for a header button, so the title doesn't shift. `true` is a
	 *  `sm` button, `"default"` a default-size one. */
	action?: boolean | "default";
	/** Overrides the default `max-w-5xl`, to match the view's container. */
	className?: string;
	/** Gap under the header. Must equal the view's, or the swap jumps. */
	contentClassName?: string;
	children?: ReactNode;
};

/** The view's real header over placeholders, so the title paints at once. */
export function PageSkeleton({
	title,
	description,
	action = false,
	className,
	contentClassName = "mt-6",
	children = <TableSkeleton />,
}: PageSkeletonProps) {
	return (
		<div className={cn("mx-auto max-w-5xl px-4 py-8 sm:px-8", className)}>
			{/* If the page fails, AsyncBoundary hides this skeleton but the header
			    shows through, and its error card lands in the slot below. */}
			<div className="visible">
				<PageHeader
					actions={
						action ? (
							<Skeleton
								className={cn("w-30", action === "default" ? "h-8" : "h-7")}
							/>
						) : undefined
					}
					description={description ?? <BarSlot bar="h-4 w-72" height="h-5" />}
					title={
						title ?? (
							<>
								<span className="sr-only">Loading</span>
								<BarSlot bar="h-6 w-40" height="h-8" />
							</>
						)
					}
				/>
			</div>
			<ErrorSlot className={contentClassName}>{children}</ErrorSlot>
		</div>
	);
}

// A flex slot, so the bar's room is a fixed line height and can't collapse into
// the header's margins. Spans, not the div Skeleton: it sits inside the h1.
export function BarSlot({ height, bar }: { height: string; bar: string }) {
	return (
		<span className={cn("flex items-center", height)}>
			<span
				aria-hidden
				className={cn(skeletonClassName, bar)}
				data-slot="skeleton"
			/>
		</span>
	);
}
