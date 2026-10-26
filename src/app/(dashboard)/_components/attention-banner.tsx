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

/** Floats at the bottom of the screen; render it last on the page. Dismissed until the page reloads. */
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
	// Sticky, not fixed: it keeps a slot at the page's end, so it never hides the
	// last content and showing up moves nothing above it. Status even when red:
	// it shows on every visit until fixed, so it must not cut into what a screen
	// reader is already saying.
	return (
		<div
			className={cn(
				"sticky bottom-4 z-20 mt-6 flex items-start gap-2 rounded-lg border py-2 pr-2 pl-3 text-sm shadow-md",
				TONES[tone],
			)}
			role="status"
		>
			<Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
			<div className="wrap-anywhere min-w-0 flex-1">{children}</div>
			<Button
				className="-my-1 hover:bg-current/10 hover:text-current dark:hover:bg-current/10"
				onClick={() => setDismissed(true)}
				size="icon-sm"
				variant="ghost"
			>
				<XIcon aria-hidden />
				<span className="sr-only">Dismiss</span>
			</Button>
		</div>
	);
}
