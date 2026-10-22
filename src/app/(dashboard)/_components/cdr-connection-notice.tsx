import { AlertTriangle, Info } from "lucide-react";

import { cn } from "~/lib/utils";
import type { ConnectionNotice } from "./cdr-connection.display";

const TONES = {
	alert:
		"border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] text-[var(--badge-spend-fg)]",
	warn: "border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)]",
} as const;

export function CdrConnectionNotice({ notice }: { notice: ConnectionNotice }) {
	const Icon = notice.tone === "alert" ? AlertTriangle : Info;
	return (
		<div
			className={cn(
				"mt-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
				TONES[notice.tone],
			)}
			role={notice.tone === "alert" ? "alert" : "status"}
		>
			<Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
			<p className="min-w-0">
				<span className="font-medium">{notice.title}.</span> {notice.detail}
			</p>
		</div>
	);
}
