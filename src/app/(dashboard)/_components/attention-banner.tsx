"use client";

import { AlertTriangle, Info, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const TONES = {
	alert:
		"border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] text-[var(--badge-spend-fg)]",
	warn: "border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)]",
} as const;

/** Sticks to the screen's bottom edge; render it last on the page. Dismissal lasts until the page remounts. */
export function AttentionBanner({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone: "alert" | "warn";
}) {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) return null;
	const Icon = tone === "alert" ? AlertTriangle : Info;
	// Sticky, not fixed: its own slot at page end, so it never covers the last content.
	// Status even when red: it repeats every visit, so it mustn't interrupt a screen reader.
	return (
		<div
			className={cn(
				"sticky bottom-4 z-20 mt-6 flex items-start gap-2 rounded-lg border py-2 pr-2 pl-3 text-sm shadow-md",
				TONES[tone],
			)}
			ref={reserveScrollRoom}
			role="status"
		>
			<Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
			<div className="wrap-anywhere min-w-0 flex-1">{children}</div>
			<Button
				className="-my-1 hover:bg-current/10 hover:text-current focus-visible:border-current focus-visible:ring-current/50 dark:hover:bg-current/10"
				onClick={(e) => {
					// Keyboard only: Chrome focuses a clicked button too, and moving
					// focus up the page would scroll a mouse user away.
					if (e.detail === 0) focusBefore(e.currentTarget);
					setDismissed(true);
				}}
				size="icon-sm"
				variant="ghost"
			>
				<XIcon aria-hidden />
				<span className="sr-only">Dismiss</span>
			</Button>
		</div>
	);
}

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

// Base UI keeps a disabled button at tabindex 0 and its form inputs hidden at -1,
// so the selector alone lets in controls that refuse focus.
const isTabbable = (el: HTMLElement) =>
	el.tabIndex >= 0 &&
	!el.matches(":disabled") &&
	!el.closest("[aria-hidden=true], [inert]") &&
	el.checkVisibility?.() !== false;

// The X removes itself, which drops focus to the page top and loses a screen
// reader's place. The banner is last, so hand focus to the control before it.
function focusBefore(dismiss: HTMLElement) {
	const banner = dismiss.closest("[role=status]");
	if (!banner) return;
	const before = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) =>
			el.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING &&
			isTabbable(el),
	);
	before.at(-1)?.focus();
}

// 16px float gap below the banner, plus 8px of air above it.
const ROOM_ABOVE_PX = 24;

// A field focused by Tab would scroll in under the banner (WCAG 2.4.11); padding the
// page's scroll by the banner's height makes the browser stop short of it.
function reserveScrollRoom(banner: HTMLDivElement) {
	const page = document.documentElement;
	const observer = new ResizeObserver(([entry]) => {
		const height = entry?.borderBoxSize[0]?.blockSize ?? 0;
		page.style.scrollPaddingBottom = `${height + ROOM_ABOVE_PX}px`;
	});
	observer.observe(banner);
	return () => {
		observer.disconnect();
		page.style.scrollPaddingBottom = "";
	};
}
