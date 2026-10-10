"use client";

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { catchError, type ErrorInfo } from "next/error";
import {
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

type AsyncBoundaryProps = {
	/** `null` makes an invisible gate: no skeleton while pending. */
	skeleton: ReactNode | null;
	/** Read as "Loading {label}" and "Couldn't load {label}". */
	label: string;
	/** Fade content in after the skeleton showed. Off where the skeleton already draws the real header. */
	fade?: boolean;
	children: ReactNode;
};

const subscribeNever = () => () => {};

/** The only way to add a loading region (adr027). */
export function AsyncBoundary({
	skeleton,
	label,
	fade = true,
	children,
}: AsyncBoundaryProps) {
	// The server writes the content wrapper before a child suspends, so it can't
	// know whether the skeleton streamed first. Server and hydration assume it
	// did: streamed content fades on reveal and the class matches on hydrate.
	const serverOrHydrating = useSyncExternalStore(
		subscribeNever,
		() => false,
		() => true,
	);
	const [skeletonShown, setSkeletonShown] = useState(serverOrHydrating);
	const onSkeletonShown = useCallback(() => setSkeletonShown(true), []);
	// Try again unmounts its own button, which drops focus to <body>. Hand it to
	// the content once it renders.
	const focusOnReveal = useRef(false);
	const onRetry = useCallback(() => {
		focusOnReveal.current = true;
	}, []);
	const contentRef = useCallback((content: HTMLDivElement | null) => {
		if (!content || !focusOnReveal.current) return;
		focusOnReveal.current = false;
		content.focus({ preventScroll: true });
	}, []);

	if (skeleton === null) {
		return (
			<ErrorBoundary label={label} skeleton={null}>
				<Suspense fallback={null}>{children}</Suspense>
			</ErrorBoundary>
		);
	}

	return (
		<ErrorBoundary label={label} onRetry={onRetry} skeleton={skeleton}>
			<Suspense
				fallback={
					<Pending label={label} onShow={onSkeletonShown} skeleton={skeleton} />
				}
			>
				<div
					className={cn(
						"outline-none",
						fade &&
							skeletonShown &&
							"fade-in animate-in motion-reduce:animate-none",
					)}
					ref={contentRef}
					tabIndex={-1}
				>
					{children}
				</div>
			</Suspense>
		</ErrorBoundary>
	);
}

function Pending({
	label,
	skeleton,
	onShow,
}: {
	label: string;
	skeleton: ReactNode;
	onShow: () => void;
}) {
	useEffect(() => onShow(), [onShow]);

	return (
		<div aria-busy="true">
			{skeleton}
			<span className="sr-only" role="status">
				Loading {label}
			</span>
		</div>
	);
}

// catchError passes redirect() / notFound() through and gives a retry() that
// re-fetches Server Components. Its fallback is a plain function, so the hooks
// live in AsyncBoundaryError.
const ErrorBoundary = catchError(function asyncBoundaryFallback(
	{
		label,
		onRetry,
		skeleton,
	}: { label: string; onRetry?: () => void; skeleton: ReactNode | null },
	{ error, retry }: ErrorInfo,
) {
	return (
		<AsyncBoundaryError
			error={error}
			label={label}
			onRetry={onRetry}
			retry={retry}
			skeleton={skeleton}
		/>
	);
});

function AsyncBoundaryError({
	error,
	label,
	onRetry,
	retry,
	skeleton,
}: {
	error: unknown;
	label: string;
	onRetry?: () => void;
	retry: () => void;
	skeleton: ReactNode | null;
}) {
	const { reset: resetQueryErrors } = useQueryErrorResetBoundary();

	// Production forwards a generic message + digest, not the original error.
	// Log it so the failure is visible and the digest matches the server logs.
	useEffect(() => {
		console.error(error);
	}, [error]);

	if (skeleton === null) return null;

	// The hidden skeleton holds the region's size, so the page doesn't jump
	// when the error swaps in, or again when Try again brings the skeleton back.
	return (
		<div className="grid">
			<div className="invisible col-start-1 row-start-1">{skeleton}</div>
			<Card
				className="col-start-1 row-start-1 justify-center text-center"
				role="alert"
			>
				<CardContent className="flex flex-col items-center gap-3">
					<p className="text-muted-foreground text-sm">
						Couldn't load {label}.
					</p>
					<Button
						onClick={() => {
							// Without the query reset, a failed suspense query rethrows its
							// cached error instead of refetching. Never catchError's reset():
							// it re-renders without re-fetching Server Components.
							resetQueryErrors();
							onRetry?.();
							retry();
						}}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
