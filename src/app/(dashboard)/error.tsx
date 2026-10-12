"use client";

import { useEffect } from "react";

import { PageHeader } from "~/components/page-header";
import { RetryCard } from "~/components/retry-card";
import { isAuthError } from "~/trpc/auth-errors";

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

// Last resort for pages with no error boundary of their own. Most failures are
// caught lower down. Wide container fits every page.
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

	// A stale session is already reloading to sign-in. Don't flash a failure first.
	if (isAuthError(error)) return null;

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
