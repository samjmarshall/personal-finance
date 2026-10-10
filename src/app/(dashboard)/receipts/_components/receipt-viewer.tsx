"use client";

import {
	FileText,
	Loader2Icon,
	SquareArrowOutUpRight,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { buttonVariants } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	type ReceiptMediaKind,
	receiptHtmlUrl,
	receiptImageUrl,
	receiptMediaKind,
} from "~/domain/receipts";
import { cn } from "~/lib/utils";

const DESCRIPTION: Record<ReceiptMediaKind, string> = {
	image: "Original image",
	pdf: "Original PDF",
	text: "Original email. Remote images, scripts and most links are blocked.",
};

// Android Chrome has no in-frame PDF viewer: the frame stays blank or downloads,
// and never fires onLoad, so the spinner would spin forever.
function canFramePdf() {
	return (
		typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false
	);
}

// A processed receipt with no vendor is still worth opening (the image is the
// source of truth); fall back to a neutral title rather than blank.
export function receiptTitle(vendor: string | null) {
	return vendor?.trim() ? vendor : "Receipt";
}

const PLACEHOLDER =
	"flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground";

const SURFACE =
	"relative rounded-lg border border-border bg-muted/40 overflow-hidden";

/**
 * The original receipt, full size. An iframe can't expose its HTTP status, so a
 * missing PDF or email body shows the route's plain "Not found" inside the frame;
 * only an image gets the in-app error. Escape pressed inside a frame stays in that
 * frame; Close still works.
 */
export function ReceiptViewer({
	receiptId,
	contentType,
	vendor,
	open,
	onOpenChange,
}: {
	receiptId: number;
	contentType: string | null;
	vendor: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const kind = receiptMediaKind(contentType);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-5xl">
				<DialogHeader>
					{/* pr-8 keeps a long vendor name clear of the corner Close button. */}
					<DialogTitle className="pr-8">{receiptTitle(vendor)}</DialogTitle>
					<DialogDescription>
						{kind ? DESCRIPTION[kind] : "Original receipt"}
					</DialogDescription>
				</DialogHeader>
				{/* Keyed so a new receipt starts from a fresh loading state. */}
				<ViewerSurface
					key={receiptId}
					kind={kind}
					receiptId={receiptId}
					vendor={vendor}
				/>
			</DialogContent>
		</Dialog>
	);
}

function ViewerSurface({
	kind,
	receiptId,
	vendor,
}: {
	kind: ReceiptMediaKind | null;
	receiptId: number;
	vendor: string | null;
}) {
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	const onLoad = () => setLoaded(true);

	if (failed || kind === null) return <LoadError />;

	if (kind === "pdf") {
		const src = receiptImageUrl(receiptId);
		if (!canFramePdf())
			return (
				<div className={cn(SURFACE, PLACEHOLDER)}>
					<FileText aria-hidden className="h-8 w-8" />
					<p className="text-sm">Preview isn't available on this device.</p>
					<NewTabLink href={src} primary />
				</div>
			);
		return (
			<WithNewTabLink href={src}>
				<div className={cn(SURFACE, "w-full")}>
					{!loaded && <LoadingOverlay />}
					{/* Not sandboxed: Chrome's PDF viewer won't run in a sandboxed frame,
					    and these are the same bytes the link opens top-level. */}
					<iframe
						className="block h-[75dvh] w-full"
						onLoad={onLoad}
						src={src}
						title="Receipt PDF"
					/>
				</div>
			</WithNewTabLink>
		);
	}

	if (kind === "text") {
		const src = receiptHtmlUrl(receiptId);
		return (
			<WithNewTabLink href={src}>
				<div className={cn(SURFACE, "w-full")}>
					{!loaded && <LoadingOverlay />}
					{/* Untrusted vendor markup (adr019). No sandbox tokens gives it an opaque
					    origin, no script and no top navigation; a link click navigates only
					    this frame. White because e-receipts assume it, even in dark mode. */}
					<iframe
						className="block h-[75dvh] w-full bg-white"
						onLoad={onLoad}
						referrerPolicy="no-referrer"
						sandbox=""
						src={src}
						title="Emailed receipt"
					/>
				</div>
			</WithNewTabLink>
		);
	}

	const src = receiptImageUrl(receiptId);
	return (
		<WithNewTabLink href={src}>
			<section
				aria-label="Receipt image"
				className={cn(
					SURFACE,
					"max-h-[75dvh] min-h-48 w-full overflow-auto outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
				)}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 — arrow keys and PageDown can only scroll a tall receipt from focus, and the dialog's focus trap skips a scroller with no tabindex
				tabIndex={0}
			>
				{!loaded && <LoadingOverlay />}
				{/* biome-ignore lint/performance/noImgElement: private-blob proxy, not a static asset for next/image */}
				<img
					alt={vendor?.trim() ? `Receipt from ${vendor}` : "Receipt image"}
					className="mx-auto block h-auto max-w-full"
					onError={() => setFailed(true)}
					onLoad={onLoad}
					src={src}
				/>
			</section>
		</WithNewTabLink>
	);
}

// The tab gives what the dialog can't: browser zoom, and room for a wide receipt
// on a phone.
function WithNewTabLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col items-start gap-3">
			{children}
			<NewTabLink href={href} />
		</div>
	);
}

function NewTabLink({
	href,
	primary = false,
}: {
	href: string;
	primary?: boolean;
}) {
	return (
		<a
			// cn() merges away the base border-transparent, as Button does; without it
			// the outline border never shows.
			className={cn(
				primary
					? buttonVariants()
					: buttonVariants({ variant: "outline", size: "sm" }),
			)}
			href={href}
			rel="noreferrer"
			target="_blank"
		>
			Open in new tab
			<SquareArrowOutUpRight aria-hidden data-icon="inline-end" />
		</a>
	);
}

function LoadingOverlay() {
	return (
		<div
			aria-label="Loading receipt"
			className="absolute inset-0 flex items-center justify-center text-muted-foreground"
			role="status"
		>
			<Loader2Icon aria-hidden className="h-5 w-5 animate-spin" />
		</div>
	);
}

function LoadError() {
	return (
		<p
			className="flex items-start gap-2 rounded-md border border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] px-3 py-2 text-[var(--badge-spend-fg)] text-xs"
			role="alert"
		>
			<TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<span>Couldn't load this receipt.</span>
		</p>
	);
}
