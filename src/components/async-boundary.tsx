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
import { isAuthError } from "~/trpc/auth-errors";

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
	// Server can't know if the skeleton streamed first. Assume it did, so
	// streamed content fades in and hydration matches.
	const serverOrHydrating = useSyncExternalStore(
		subscribeNever,
		() => false,
		() => true,
	);
	const [skeletonShown, setSkeletonShown] = useState(serverOrHydrating);
	const onSkeletonShown = useCallback(() => setSkeletonShown(true), []);
	// Try again unmounts its own button, which drops focus to <body>. Hand it to
	// whatever renders next: the content, or a fresh Try again if it failed again.
	const focusOnReveal = useRef(false);
	const onRetry = useCallback(() => {
		focusOnReveal.current = true;
	}, []);
	const focusRef = useCallback((element: HTMLElement | null) => {
		if (!element || !focusOnReveal.current) return;
		focusOnReveal.current = false;
		element.focus({ preventScroll: true });
	}, []);

	if (skeleton === null) {
		return (
			<ErrorBoundary label={label} skeleton={null}>
				<Suspense fallback={null}>{children}</Suspense>
			</ErrorBoundary>
		);
	}

	return (
		<ErrorBoundary
			focusRef={focusRef}
			label={label}
			onRetry={onRetry}
			skeleton={skeleton}
		>
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
					ref={focusRef}
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

	// Status sits outside the busy region: screen readers hold back announcements
	// from inside one.
	return (
		<>
			<div aria-busy="true">{skeleton}</div>
			<span className="sr-only" role="status">
				Loading {label}
			</span>
		</>
	);
}

// Next's error boundary: lets redirects and not-found pass, and its retry
// re-fetches server content. Its fallback can't use hooks, so a child does.
const ErrorBoundary = catchError(function asyncBoundaryFallback(
	{
		focusRef,
		label,
		onRetry,
		skeleton,
	}: {
		focusRef?: (element: HTMLElement | null) => void;
		label: string;
		onRetry?: () => void;
		skeleton: ReactNode | null;
	},
	{ error, retry }: ErrorInfo,
) {
	return (
		<AsyncBoundaryError
			error={error}
			focusRef={focusRef}
			label={label}
			onRetry={onRetry}
			retry={retry}
			skeleton={skeleton}
		/>
	);
});

function AsyncBoundaryError({
	error,
	focusRef,
	label,
	onRetry,
	retry,
	skeleton,
}: {
	error: unknown;
	focusRef?: (element: HTMLElement | null) => void;
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
	// A stale session is already reloading to sign-in. Don't flash a failure first.
	if (isAuthError(error)) return skeleton;

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
							// Clear cached query errors first, or a failed query rethrows its
							// old error. Next's plain reset skips re-fetching server content.
							resetQueryErrors();
							onRetry?.();
							retry();
						}}
						ref={focusRef}
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
