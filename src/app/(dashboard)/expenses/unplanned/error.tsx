"use client";

import { useEffect } from "react";

import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

// Route error boundary: the anchor and expense-list suspense queries throw here
// on a fetch failure instead of blanking the segment. `retry` (Next 16 renamed
// it from `reset`) re-runs the failed render. Degrade, never error.
export default function UnplannedError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	// Production forwards the failure as a generic message + digest, not the
	// original error — log it so the boundary firing is visible and the digest
	// matches the server logs, instead of failing silently.
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
			<PageHeader
				description="Spend not yet linked to a planned expense."
				title="Unplanned"
			/>
			<Card
				className="mt-6 text-center [--card-spacing:--spacing(10)]"
				role="alert"
			>
				<CardContent className="flex flex-col items-center gap-3">
					<p className="text-muted-foreground text-sm">
						Couldn't load the Unplanned page.
					</p>
					<Button onClick={() => retry()} size="sm" variant="outline">
						Try again
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
