"use client";

import { SquareArrowOutUpRight } from "lucide-react";

import type { CdrSyncState } from "~/domain/cdr";
import { useHydrating } from "~/hooks/use-hydrating";
import { AttentionBanner } from "./attention-banner";
import {
	type ConnectionNotice,
	connectionNotice,
} from "./cdr-connection.display";

const REDBARK_DASHBOARD = "https://app.redbark.com";

// The server runs in UTC, so a sync on a Sydney morning would read as the day
// before. Nothing renders until mounted, so the date is the member's own day.
export function ClientConnectionNotice({ states }: { states: CdrSyncState[] }) {
	const notice = useHydrating() ? null : connectionNotice(states);
	return notice ? <CdrConnectionNotice notice={notice} /> : null;
}

export function CdrConnectionNotice({ notice }: { notice: ConnectionNotice }) {
	// The link follows the lines it fixes; behind lines get their own paragraph
	// so it never reads as their fix.
	const lead = notice.reauthorize ?? notice.behind;
	return (
		<AttentionBanner tone={notice.tone}>
			<div className="space-y-1">
				<p>
					<span className="font-medium">{notice.title}.</span> {lead}
					{notice.reauthorize && (
						<>
							{" "}
							<a
								className="inline-flex items-center gap-1 rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
								href={REDBARK_DASHBOARD}
								rel="noreferrer"
								target="_blank"
							>
								Open RedBark <span className="sr-only">(opens in new tab)</span>
								<SquareArrowOutUpRight aria-hidden className="h-3.5 w-3.5" />
							</a>
						</>
					)}
				</p>
				{notice.reauthorize && notice.behind && <p>{notice.behind}</p>}
			</div>
		</AttentionBanner>
	);
}
