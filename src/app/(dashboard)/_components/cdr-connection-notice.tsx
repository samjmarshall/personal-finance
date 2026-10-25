"use client";

import { AlertTriangle, Info, SquareArrowOutUpRight } from "lucide-react";

import type { CdrSyncState } from "~/domain/cdr";
import { useHydrating } from "~/hooks/use-hydrating";
import { cn } from "~/lib/utils";
import {
	type ConnectionNotice,
	connectionNotice,
} from "./cdr-connection.display";

const REDBARK_DASHBOARD = "https://app.redbark.com";

const TONES = {
	alert:
		"border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] text-[var(--badge-spend-fg)]",
	warn: "border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)]",
} as const;

// The server runs in UTC, so a sync on a Sydney morning would read as the day
// before. Nothing renders until mounted, so the date is the member's own day.
export function ClientConnectionNotice({ states }: { states: CdrSyncState[] }) {
	const notice = useHydrating() ? null : connectionNotice(states);
	return notice ? <CdrConnectionNotice notice={notice} /> : null;
}

export function CdrConnectionNotice({ notice }: { notice: ConnectionNotice }) {
	const Icon = notice.tone === "alert" ? AlertTriangle : Info;
	// Status even when red: it shows on every visit until fixed, so it must not
	// cut into what a screen reader is already saying.
	return (
		<div
			className={cn(
				"mt-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
				TONES[notice.tone],
			)}
			role="status"
		>
			<Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
			<p className="min-w-0">
				<span className="font-medium">{notice.title}.</span> {notice.detail}
				{notice.inRedBark && (
					<>
						{" "}
						<a
							className="inline-flex items-center gap-1 rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
							href={REDBARK_DASHBOARD}
							rel="noreferrer"
							target="_blank"
						>
							Open RedBark
							<SquareArrowOutUpRight aria-hidden className="h-3.5 w-3.5" />
						</a>
					</>
				)}
			</p>
		</div>
	);
}
