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
import { type KeyboardEvent, useRef, useState } from "react";

import {
	type ReceiptDetail,
	receiptPipeline,
	type StageState,
} from "~/domain/receipts";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function fmtIso(d: Date | string | null | undefined): string {
	if (!d) return "—";
	const t = new Date(d);
	return Number.isNaN(t.getTime()) ? "—" : t.toISOString();
}

// Wall-clock createdAt→updatedAt; null when the receipt hasn't been updated yet
// or the clocks disagree (negative), so callers render "—" rather than a lie.
function processingMs(data: ReceiptDetail): number | null {
	if (!data.updatedAt) return null;
	const ms =
		new Date(data.updatedAt).getTime() - new Date(data.createdAt).getTime();
	return ms >= 0 ? ms : null;
}

function fmtMs(ms: number | null): string {
	if (ms == null) return "—";
	return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function metaRows(
	data: ReceiptDetail,
	traceId: string | null,
): Array<[string, string]> {
	return [
		["Trace ID", traceId ?? "—"],
		["Receipt ID", `#${data.id}`],
		["Status", data.status],
		["Channel", data.channel],
		["Content type", data.contentType ?? "—"],
		["Content hash", data.contentHash ?? "—"],
		["Blob pathname", data.blobPathname],
		[
			"Transaction ID",
			data.transactionId != null ? `#${data.transactionId}` : "—",
		],
		[
			"Duplicate of",
			data.duplicateOfId != null ? `#${data.duplicateOfId}` : "—",
		],
		["Items extracted", String(data.items.length)],
		["Created", fmtIso(data.createdAt)],
		["Updated", fmtIso(data.updatedAt)],
		["Processing time", fmtMs(processingMs(data))],
	];
}

function diagnosticsJson(data: ReceiptDetail, traceId: string | null): string {
	return JSON.stringify(
		{
			traceId,
			receiptId: data.id,
			status: data.status,
			channel: data.channel,
			contentType: data.contentType,
			contentHash: data.contentHash,
			blobPathname: data.blobPathname,
			transactionId: data.transactionId,
			duplicateOfId: data.duplicateOfId,
			createdAt: data.createdAt,
			updatedAt: data.updatedAt,
			error: data.error,
			vendor: data.vendor,
			total: data.total,
			currency: data.currency,
			receiptDate: data.receiptDate,
			itemCount: data.items.length,
			rawExtraction: data.rawJson,
		},
		null,
		2,
	);
}

function rawJsonText(data: ReceiptDetail): string {
	if (data.rawJson == null)
		return "// no raw extraction stored for this receipt";
	return JSON.stringify(data.rawJson, null, 2);
}

function useCopy() {
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	function copy(text: string, key: string) {
		void navigator.clipboard?.writeText(text);
		setCopiedKey(key);
		setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
	}
	return { copiedKey, copy };
}

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

// The vertical ingest stepper, driven by the pure status→stages derivation.
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
								{s.at !== "—" && (
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
// Developer details section
// ---------------------------------------------------------------------------

type Tab = "timeline" | "raw" | "meta";
const TABS: Array<[Tab, string]> = [
	["timeline", "Timeline"],
	["raw", "Raw"],
	["meta", "Metadata"],
];

export function MoreDetails({ data }: { data: ReceiptDetail }) {
	const { copiedKey, copy } = useCopy();
	const [tab, setTab] = useState<Tab>("timeline");
	const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
	const rows = metaRows(data, data.traceId);

	// Roving-tabindex arrow/Home/End movement per the WAI-ARIA tabs pattern —
	// hand-rolled because the app has no shared Tabs primitive.
	function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const order = TABS.map(([k]) => k);
		const i = order.indexOf(tab);
		const to =
			e.key === "ArrowRight" || e.key === "ArrowDown"
				? order[(i + 1) % order.length]
				: e.key === "ArrowLeft" || e.key === "ArrowUp"
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
			aria-labelledby="dev-details-heading"
			className="mt-1 rounded-lg border border-border bg-muted/10"
		>
			<header className="flex items-center gap-2 border-border border-b px-3 py-2">
				<Braces aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
				<span
					className="font-medium text-foreground text-xs"
					id="dev-details-heading"
				>
					Developer details
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
						aria-label="Developer details views"
						className="flex gap-1 border-border border-b"
						onKeyDown={onTabKeyDown}
						role="tablist"
					>
						{TABS.map(([key, label]) => (
							<button
								aria-controls="dev-details-panel"
								aria-selected={tab === key}
								className={cn(
									"-mb-px rounded-sm border-b-2 px-2.5 py-1.5 font-medium text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
									tab === key
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
								id={`dev-details-tab-${key}`}
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
						aria-labelledby={`dev-details-tab-${tab}`}
						className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						id="dev-details-panel"
						role="tabpanel"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA APG — a tabpanel is made focusable so the Timeline panel (which has no focusable content) stays keyboard-reachable
						tabIndex={0}
					>
						{tab === "timeline" && <Timeline data={data} />}

						{tab === "raw" && (
							<div className="flex flex-col gap-2">
								<div className="flex justify-end">
									<CopyButton
										copiedKey={copiedKey}
										copyKey="raw"
										label="Copy JSON"
										onCopy={copy}
										value={rawJsonText(data)}
									/>
								</div>
								<pre className="max-h-72 overflow-auto rounded-md border border-border bg-background px-2 py-2 font-mono text-[11px] text-foreground">
									{rawJsonText(data)}
								</pre>
							</div>
						)}

						{tab === "meta" && (
							<div className="flex flex-col gap-2">
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
								<div className="flex justify-end">
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
