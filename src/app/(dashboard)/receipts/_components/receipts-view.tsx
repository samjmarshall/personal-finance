"use client";

import { FileText, Mail, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { DeleteConfirmDialog } from "~/components/delete-confirm-dialog";
import { Money } from "~/components/money";
import { PageHeader } from "~/components/page-header";
import { SelectField, type SelectFieldOption } from "~/components/select-field";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { receiptImageUrl, receiptMediaKind } from "~/domain/receipts";
import { ReceiptStatus } from "~/lib/constants";
import { cn, formatDate } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { ReceiptDetail } from "./receipt-detail";
import { ReceiptUpload } from "./receipt-upload";

type ReceiptRow = RouterOutputs["receipt"]["list"][number];

type StatusStyle = { label: string; badge: string; dot: string };

// Lifecycle at a glance: amber while pending, positive once processed, clay-red on
// failure, neutral for a deduped copy. Tokens mirror priorityStyle.
const STATUS_STYLE: Record<ReceiptStatus, StatusStyle> = {
	[ReceiptStatus.Pending]: {
		label: "Pending",
		badge:
			"bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)] border-[color:var(--badge-warn-border)]",
		dot: "bg-warning",
	},
	[ReceiptStatus.Processed]: {
		label: "Processed",
		badge:
			"bg-[var(--badge-positive-bg)] text-[var(--badge-positive-fg)] border-[color:var(--badge-positive-border)]",
		dot: "bg-positive",
	},
	[ReceiptStatus.Failed]: {
		label: "Failed",
		badge:
			"bg-[var(--badge-spend-bg)] text-[var(--badge-spend-fg)] border-[color:var(--badge-spend-border)]",
		dot: "bg-spend",
	},
	[ReceiptStatus.Duplicate]: {
		label: "Duplicate",
		badge:
			"bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)] border-[color:var(--badge-info-border)]",
		dot: "bg-[var(--badge-info-dot)]",
	},
};

const STATUS_FILTER_ITEMS: SelectFieldOption<ReceiptStatus | null>[] = [
	{ value: null, label: "All statuses" },
	...Object.values(ReceiptStatus).map((s) => ({
		value: s,
		label: STATUS_STYLE[s].label,
	})),
];

// Its own control, not a rider on the status filter: "still needs a transaction" is a
// separate question from "where is it in the pipeline", and hiding it inside Status
// made a matched receipt unreachable through every value of that dropdown.
const MATCH_FILTER_ITEMS: SelectFieldOption<"all" | "unmatched">[] = [
	{ value: "all", label: "Matched and unmatched" },
	{ value: "unmatched", label: "Unmatched only" },
];

// Only images survive the blob proxy's renderable allowlist; a PDF or a forwarded
// email body comes back as octet-stream under nosniff, so an <img> would render
// broken. Null means "safe to show the real thing".
function previewIcon(contentType: string | null) {
	const kind = receiptMediaKind(contentType);
	if (kind === "pdf") return FileText;
	if (kind === "text") return Mail;
	return null;
}

export function ReceiptsView({ uploadPrefix }: { uploadPrefix: string }) {
	const [status, setStatus] = useState<ReceiptStatus | null>(null);
	const [match, setMatch] = useState<"all" | "unmatched">("all");
	const [detailId, setDetailId] = useState<number | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ReceiptRow | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const unmatchedOnly = match === "unmatched";
	const { data, isError, isFetching } = api.receipt.list.useQuery(
		{ status: status ?? undefined, unmatchedOnly },
		{
			placeholderData: (prev) => prev,
			// Extraction runs async in Inngest; poll only while a row is still pending
			// so the pending→processed flip lands without a manual reload.
			refetchInterval: (query) =>
				query.state.data?.some((r) => r.status === ReceiptStatus.Pending)
					? 3000
					: false,
		},
	);

	const utils = api.useUtils();
	const retry = api.receipt.retry.useMutation({
		onSuccess: () => utils.receipt.invalidate(),
	});
	const remove = api.receipt.delete.useMutation({
		onSuccess: () => utils.receipt.invalidate(),
	});

	const rows = data ?? [];

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={<ReceiptUpload uploadPrefix={uploadPrefix} />}
				description="Upload a photo or PDF; we extract the vendor, total and line items."
				title="Receipts"
			/>

			<Card className="mt-6 overflow-visible">
				<CardContent className="flex flex-wrap items-center gap-2">
					<SelectField
						aria-label={`Filter by status, currently ${status ?? "all statuses"}`}
						className="min-w-40"
						items={STATUS_FILTER_ITEMS}
						onValueChange={(v) => setStatus(v)}
						value={status}
					/>
					<SelectField
						aria-label={`Filter by match, currently ${match === "unmatched" ? "unmatched only" : "matched and unmatched"}`}
						className="min-w-52"
						items={MATCH_FILTER_ITEMS}
						onValueChange={(v) => setMatch(v ?? "all")}
						value={match}
					/>
				</CardContent>
			</Card>

			<Card className="mt-4 [--card-spacing:0px]">
				<div className="overflow-x-auto">
					<table
						aria-label="Receipts"
						className="w-full min-w-[48rem] border-collapse text-sm"
					>
						<thead>
							<tr className="border-border border-b bg-muted/40 text-left text-muted-foreground text-xs">
								<th className="w-14 px-4 py-2.5 font-medium" />
								<th className="px-4 py-2.5 font-medium">Vendor</th>
								<th className="px-4 py-2.5 text-right font-medium">Total</th>
								<th className="px-4 py-2.5 font-medium">Date</th>
								<th className="px-4 py-2.5 font-medium">Member</th>
								<th className="px-4 py-2.5 font-medium">Status</th>
								<th className="w-20 px-4 py-2.5" />
							</tr>
						</thead>
						<tbody
							className={cn(
								"divide-y divide-border transition-opacity",
								isFetching && "opacity-60",
							)}
						>
							{rows.map((r) => {
								const style = STATUS_STYLE[r.status];
								const isDuplicate = r.status === ReceiptStatus.Duplicate;
								const PreviewIcon = previewIcon(r.contentType);
								return (
									<tr className="group hover:bg-muted/30" key={r.id}>
										<td className="px-4 py-2.5">
											<button
												aria-label={`Open ${r.vendor ?? "unread receipt"}`}
												className="block h-10 w-10 overflow-hidden rounded-md border border-border bg-muted/40"
												onClick={() => setDetailId(r.id)}
												type="button"
											>
												{PreviewIcon ? (
													<span className="flex h-full w-full items-center justify-center text-muted-foreground">
														<PreviewIcon className="h-4 w-4" />
													</span>
												) : (
													// biome-ignore lint/performance/noImgElement: private-blob proxy, not a static asset for next/image
													<img
														alt=""
														className="h-full w-full object-cover"
														loading="lazy"
														src={receiptImageUrl(r.id)}
													/>
												)}
											</button>
										</td>
										<td className="px-4 py-3">
											<button
												className="text-left font-medium text-foreground hover:underline"
												onClick={() => setDetailId(r.id)}
												type="button"
											>
												{r.vendor ?? "Unread receipt"}
											</button>
											{isDuplicate && r.duplicateOfId && (
												<button
													className="mt-0.5 block text-muted-foreground text-xs hover:underline"
													onClick={() => setDetailId(r.duplicateOfId)}
													type="button"
												>
													Duplicate of #{r.duplicateOfId}
												</button>
											)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-right">
											{r.total != null ? (
												<Money tone="spend" value={r.total} />
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</td>
										<td className="tabular whitespace-nowrap px-4 py-3 text-muted-foreground">
											{r.receiptDate ? formatDate(r.receiptDate) : "—"}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
											{r.userName ?? "—"}
										</td>
										<td className="px-4 py-3">
											<Badge className={style.badge}>
												<span
													className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
												/>
												{style.label}
											</Badge>
										</td>
										<td className="px-4 py-3">
											<div className="flex justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
												{r.status === ReceiptStatus.Failed && (
													<button
														aria-label={`Retry ${r.vendor ?? "receipt"}`}
														className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
														disabled={
															retry.isPending && retry.variables?.id === r.id
														}
														onClick={() => retry.mutate({ id: r.id })}
														type="button"
													>
														<RotateCw className="h-3.5 w-3.5" />
													</button>
												)}
												<button
													aria-label={`Delete ${r.vendor ?? "receipt"}`}
													className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
													onClick={() => {
														setDeleteTarget(r);
														setConfirmOpen(true);
													}}
													type="button"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{/* Outside the horizontal-scroll wrapper so the copy wraps on a phone
				    instead of being clipped by the table's min-width. isError forks the
				    copy so a load failure never reads as an empty to-do queue. */}
				{!rows.length &&
					(isError ? (
						<p className="px-4 py-16 text-center text-muted-foreground text-sm">
							Couldn&apos;t load receipts. Refresh to try again.
						</p>
					) : (
						<p className="px-4 py-16 text-center text-muted-foreground text-sm">
							{status || unmatchedOnly
								? "No receipts match these filters."
								: "No receipts yet. Upload one to get started."}
						</p>
					))}
			</Card>

			<ReceiptDetail
				onOpenChange={(open) => !open && setDetailId(null)}
				receiptId={detailId}
			/>

			<DeleteConfirmDialog
				label={deleteTarget?.vendor ?? "this receipt"}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</div>
	);
}
