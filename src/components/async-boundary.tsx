"use client";

import { catchError, type ErrorInfo } from "next/error";
import {
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { RetryCard } from "~/components/retry-card";
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
		// The user moved on while it loaded. Don't pull focus back.
		if (document.activeElement !== document.body) return;
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

type ErrorBoundaryProps = {
	focusRef?: (element: HTMLElement | null) => void;
	label: string;
	onRetry?: () => void;
	skeleton: ReactNode | null;
};

// Next's error boundary: lets redirects and not-found pass, and its retry
// re-fetches server content. Its fallback can't use hooks, so a child does.
const ErrorBoundary = catchError(function asyncBoundaryFallback(
	props: ErrorBoundaryProps,
	{ error, retry }: ErrorInfo,
) {
	return <AsyncBoundaryError {...props} error={error} retry={retry} />;
});

function AsyncBoundaryError({
	error,
	focusRef,
	label,
	onRetry,
	retry,
	skeleton,
}: ErrorBoundaryProps & { error: unknown; retry: () => void }) {
	const wrapper = useRef<HTMLDivElement>(null);
	// undefined until looked for, so the card mounts once, in its final place.
	const [slot, setSlot] = useState<HTMLElement | null>();

	// Production forwards a generic message + digest, not the original error.
	// Log it so the failure is visible and the digest matches the server logs.
	useEffect(() => {
		console.error(error);
	}, [error]);

	// A page skeleton (PageSkeleton) marks its body, so a page-level failure keeps
	// the page's header and container instead of a bare card.
	useLayoutEffect(() => {
		setSlot(wrapper.current?.querySelector<HTMLElement>("[data-error-slot]"));
	}, []);

	if (skeleton === null) return null;
	// A stale session is already reloading to sign-in. Don't flash a failure first.
	if (isAuthError(error)) return skeleton;

	const card = (
		<RetryCard
			buttonRef={focusRef}
			className="visible col-start-1 row-start-1"
			label={label}
			onRetry={onRetry}
			retry={retry}
		/>
	);

	// Hidden skeleton keeps the region's size: no jump on error or on Try again.
	// Message at top: centred in a tall region, it lands below the fold. Bars stay
	// hidden even in a header that shows through: a failed page keeps only its text.
	return (
		<div
			className="grid grid-cols-1 [&_[data-slot=skeleton]]:invisible"
			ref={wrapper}
		>
			<div className="invisible col-start-1 row-start-1">{skeleton}</div>
			{slot === null && card}
			{slot && createPortal(card, slot)}
		</div>
	);
}
