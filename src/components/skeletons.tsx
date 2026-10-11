import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

// Sized to the real markup, so no layout shift on swap. Roots are hidden from
// screen readers; the boundary's status text speaks for the region.

const indices = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Same cell padding and line heights as the list tables (transactions-view). */
export function TableSkeleton({
	rows = 8,
	cols = 5,
}: {
	rows?: number;
	cols?: number;
}) {
	return (
		<Card aria-hidden className="[--card-spacing:0px]">
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-border border-b bg-muted/40">
						{indices(cols).map((col) => (
							<th className="px-4 py-2.5" key={col}>
								<Skeleton className="h-4 w-16" />
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{indices(rows).map((row) => (
						<tr key={row}>
							{indices(cols).map((col) => (
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

/** Matches the dashboard/settings card's heading and body sizes, so no shift. */
export function CardSkeleton() {
	return (
		<Card aria-hidden>
			<CardContent>
				<HeadingSkeleton />
				<div className="flex flex-col gap-3">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-2/3" />
				</div>
			</CardContent>
		</Card>
	);
}

/** Title + subtitle lines, 36 + 16 gap like the real card headings. */
export function HeadingSkeleton() {
	return (
		// Flex, so the bars' margins add up instead of collapsing.
		<div className="mb-4 flex flex-col">
			<Skeleton className="my-0.5 h-4 w-32" />
			<Skeleton className="my-0.5 h-3 w-48" />
		</div>
	);
}

/** `height` in px, matching the chart's fixed height. */
export function ChartSkeleton({ height }: { height: number }) {
	return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}
