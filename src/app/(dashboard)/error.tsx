"use client";

import { useEffect } from "react";

import { PageHeader } from "~/components/page-header";
import { RetryCard } from "~/components/retry-card";

// A failed retry remounts this file, so the "refocus Try again" note has to
// outlive it.
let focusOnMount = false;

function focusTryAgain(button: HTMLButtonElement | null) {
	if (!button || !focusOnMount) return;
	focusOnMount = false;
	// The user moved on while it loaded. Don't pull focus back.
	if (document.activeElement !== document.body) return;
	button.focus({ preventScroll: true });
}

// Last resort: a page with no boundary of its own throws here instead of
// blanking the segment. Most failures land in an AsyncBoundary first. Those
// pages (overview, transactions, receipts) all use the wide container.
export default function DashboardError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	// Production forwards a generic message + digest, not the original error.
	// Log it so the digest matches the server logs.
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader title="Something went wrong" />
			<RetryCard
				buttonRef={focusTryAgain}
				className="mt-6"
				label="this page"
				onRetry={() => {
					focusOnMount = true;
				}}
				retry={retry}
			/>
		</div>
	);
}
