"use client";

import {
	Braces,
	Check,
	Circle,
	CircleDashed,
	CircleX,
	ClipboardCopy,
	ExternalLink,
	Loader2,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import {
	type ReceiptDetail,
	receiptPipeline,
	type StageState,
} from "~/domain/receipts";
import { cn } from "~/lib/utils";
import { diagnosticsJson, metaRows, rawJsonText } from "./more-details.display";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function CopyButton({
	value,
	copyKey,
	label,
	copiedKey,
	onCopy,
}: {
	value: string;
	copyKey: string;
	label: string;
	copiedKey: string | null;
	onCopy: (text: string, key: string) => void;
}) {
	const copied = copiedKey === copyKey;
	return (
		<button
			className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			onClick={() => onCopy(value, copyKey)}
			type="button"
		>
			{copied ? (
				<Check className="h-3 w-3" />
			) : (
				<ClipboardCopy className="h-3 w-3" />
			)}
			{copied ? "Copied" : label}
		</button>
	);
}

// X-Trace-ID + Copy + Open-trace. A null id (OTel unregistered at ingest) reads
// "—" with no Copy; "Open trace" shows only when the server built a viewer URL.
function TraceHeader({
	traceId,
	traceUrl,
	copiedKey,
	copy,
}: {
	traceId: string | null;
	traceUrl: string | null;
	copiedKey: string | null;
	copy: (text: string, key: string) => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
			<div className="min-w-0">
				<div className="text-muted-foreground text-xs">X-Trace-ID</div>
				<div className="truncate font-mono text-foreground text-sm">
					{traceId ?? "—"}
				</div>
			</div>
			<div className="flex items-center gap-2">
				{traceId && (
					<CopyButton
						copiedKey={copiedKey}
						copyKey="trace"
						label="Copy"
						onCopy={copy}
						value={traceId}
					/>
				)}
				{traceUrl && (
					<a
						className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-medium text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
						href={traceUrl}
						rel="noreferrer"
						target="_blank"
						title="Open this trace in PostHog"
					>
						<ExternalLink className="h-3 w-3" />
						Open trace
					</a>
				)}
			</div>
		</div>
	);
}

const STAGE_META: Record<
	StageState,
	{ Icon: typeof Check; cls: string; spin?: boolean }
> = {
	ok: { Icon: Check, cls: "text-[var(--badge-positive-fg)]" },
	active: { Icon: Loader2, cls: "text-[var(--badge-warn-fg)]", spin: true },
	failed: { Icon: CircleX, cls: "text-[var(--badge-spend-fg)]" },
	skipped: { Icon: CircleDashed, cls: "text-muted-foreground" },
	pending: { Icon: Circle, cls: "text-muted-foreground" },
};

function StageIcon({ state }: { state: StageState }) {
	const { Icon, cls, spin } = STAGE_META[state];
	return (
		<Icon
			aria-hidden
			className={cn("h-4 w-4 shrink-0", cls, spin && "animate-spin")}
		/>
	);
}

function Timeline({ data }: { data: ReceiptDetail }) {
	const stages = receiptPipeline(data);
	return (
		<ol className="flex flex-col">
			{stages.map((s, i) => {
				const last = i === stages.length - 1;
				return (
					<li className="flex gap-3" key={s.label}>
						<div className="flex flex-col items-center">
							<span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background">
								<StageIcon state={s.state} />
							</span>
							{!last && <span className="w-px flex-1 bg-border" />}
						</div>
						<div className={cn("min-w-0", last ? "pb-0" : "pb-4")}>
							<div className="flex items-baseline gap-2">
								<span className="font-medium text-foreground text-sm">
									{s.label}
								</span>
								{s.at != null && (
									<span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
										{s.at}
									</span>
								)}
							</div>
							<p
								className={cn(
									"break-words text-xs",
									s.state === "failed"
										? "text-[var(--badge-spend-fg)]"
										: "text-muted-foreground",
								)}
							>
								{s.detail}
							</p>
						</div>
					</li>
				);
			})}
		</ol>
	);
}

// ---------------------------------------------------------------------------
// Extraction pipeline details section
// ---------------------------------------------------------------------------

// Raw extraction JSON + its copy button. Own component so the JSON is stringified
// once per render, not once for the <pre> and again for the copy value.
function RawPanel({
	data,
	copiedKey,
	copy,
}: {
	data: ReceiptDetail;
	copiedKey: string | null;
	copy: (text: string, key: string) => void;
}) {
	const text = rawJsonText(data);
	return (
		<div className="flex flex-1 flex-col">
			<pre className="max-h-72 overflow-auto rounded-md border border-border bg-background px-2 py-2 font-mono text-[11px] text-foreground">
				{text}
			</pre>
			<div className="mt-auto flex justify-end">
				<CopyButton
					copiedKey={copiedKey}
					copyKey="raw"
					label="Copy JSON"
					onCopy={copy}
					value={text}
				/>
			</div>
		</div>
	);
}

type Tab = "timeline" | "raw" | "meta";
const TABS: Array<[Tab, string]> = [
	["timeline", "Timeline"],
	["raw", "Raw"],
	["meta", "Metadata"],
];

export function MoreDetails({ data }: { data: ReceiptDetail }) {
	// Copy-to-clipboard state is modal-local, so it lives here and is passed down as
	// explicit props — never a custom hook or context (adr001/frontend.md).
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	// Hold the reset timer so it can be cleared: copy-then-close the overlay before
	// the 1.2s elapses would otherwise fire setCopiedKey on an unmounted component.
	const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
		},
		[],
	);
	function copy(text: string, key: string) {
		// No clipboard API (insecure context / webview) or a denied write must not
		// flash "Copied" — only claim success once the write actually resolves.
		const clipboard = navigator.clipboard;
		if (!clipboard) return;
		void clipboard.writeText(text).then(
			() => {
				setCopiedKey(key);
				if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
				copyResetTimer.current = setTimeout(
					() => setCopiedKey((k) => (k === key ? null : k)),
					1200,
				);
			},
			(error: unknown) => {
				// A denied/failed write must not crash or throw a user-facing error, but it
				// must not be black-holed either — the backend captures every swallowed
				// failure at its choke points (adr015), and the client should be no different.
				// TODO: capture this once client-side PostHog error tracking lands (backend-only
				// today). Until then the button just stays idle.
				void error;
			},
		);
	}
	const [tab, setTab] = useState<Tab>("timeline");
	const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
	const rows = metaRows(data, data.traceId);

	// Unique per instance so two open overlays never share ids (heading/panel/tab
	// wiring must stay internally consistent). See settings-section.tsx.
	const baseId = useId();
	const headingId = `${baseId}-heading`;
	const panelId = `${baseId}-panel`;
	const tabId = (key: Tab) => `${baseId}-tab-${key}`;

	// Roving-tabindex movement per the WAI-ARIA tabs pattern — hand-rolled because the
	// app has no shared Tabs primitive. This tablist is horizontal, so only Left/Right
	// (+ Home/End) move between tabs; Up/Down are left to the browser to scroll the page.
	function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const order = TABS.map(([k]) => k);
		const i = order.indexOf(tab);
		const to =
			e.key === "ArrowRight"
				? order[(i + 1) % order.length]
				: e.key === "ArrowLeft"
					? order[(i - 1 + order.length) % order.length]
					: e.key === "Home"
						? order[0]
						: e.key === "End"
							? order[order.length - 1]
							: null;
		if (!to) return;
		e.preventDefault();
		setTab(to);
		tabRefs.current[to]?.focus();
	}

	return (
		<section
			aria-labelledby={headingId}
			className="mt-1 rounded-lg border border-border bg-muted/10"
		>
			<header className="flex items-center gap-2 border-border border-b px-3 py-2">
				<Braces aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="font-medium text-foreground text-xs" id={headingId}>
					Extraction pipeline details
				</span>
			</header>
			<div className="p-3">
				<div className="flex flex-col gap-3">
					<TraceHeader
						copiedKey={copiedKey}
						copy={copy}
						traceId={data.traceId}
						traceUrl={data.traceUrl}
					/>

					<div
						aria-label="Extraction pipeline details views"
						className="flex gap-1 border-border border-b"
						onKeyDown={onTabKeyDown}
						role="tablist"
					>
						{TABS.map(([key, label]) => (
							<button
								aria-controls={panelId}
								aria-selected={tab === key}
								className={cn(
									"-mb-px border-b-2 px-2.5 py-1.5 font-medium text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
									tab === key
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
								id={tabId(key)}
								key={key}
								onClick={() => setTab(key)}
								ref={(el) => {
									tabRefs.current[key] = el;
								}}
								role="tab"
								tabIndex={tab === key ? 0 : -1}
								type="button"
							>
								{label}
							</button>
						))}
					</div>

					<div
						aria-labelledby={tabId(tab)}
						className="flex min-h-96 flex-col rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						id={panelId}
						role="tabpanel"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA APG — a tabpanel is made focusable so the Timeline panel (which has no focusable content) stays keyboard-reachable
						tabIndex={0}
					>
						{tab === "timeline" && <Timeline data={data} />}

						{tab === "raw" && (
							<RawPanel copiedKey={copiedKey} copy={copy} data={data} />
						)}

						{tab === "meta" && (
							<div className="flex flex-1 flex-col gap-2">
								<table className="w-full border-collapse font-mono text-xs">
									<tbody className="divide-y divide-border">
										{rows.map(([k, v]) => (
											<tr key={k}>
												<th
													className="whitespace-nowrap py-1 pr-3 text-left align-top font-normal text-muted-foreground"
													scope="row"
												>
													{k}
												</th>
												<td className="break-all py-1 text-foreground">{v}</td>
											</tr>
										))}
									</tbody>
								</table>
								<div className="mt-auto flex justify-end">
									<CopyButton
										copiedKey={copiedKey}
										copyKey="all"
										label="Copy all as JSON"
										onCopy={copy}
										value={diagnosticsJson(data, data.traceId)}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
