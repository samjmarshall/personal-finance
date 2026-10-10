"use client";

import { skipToken } from "@tanstack/react-query";
import { Check, Loader2Icon, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Money } from "~/components/money";
import { SelectField, type SelectFieldOption } from "~/components/select-field";
import { Badge } from "~/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { receiptImageUrl } from "~/domain/receipts";
import { itemsTotalMismatch } from "~/domain/receipts/receipt-total";
import { ReceiptStatus } from "~/lib/constants";
import { formatCurrency, formatDate } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { MoreDetails } from "./more-details";
import { ReceiptSourceThumbnail } from "./receipt-source-thumbnail";
import { ReceiptViewer, receiptTitle } from "./receipt-viewer";

type Candidate = RouterOutputs["receipt"]["matchCandidates"][number];

// Enough to cover a same-day pair of similar spends without turning the banner
// into a second transaction list — the ranking already did the work.
const MAX_SUGGESTIONS = 4;

// Below half a cent the gap is rounding noise, not a difference worth naming.
const SUB_CENT = 0.005;

// Why this candidate ranked where it did, in the member's terms. Sub-cent gaps
// read as "exact" — "$0.00 off" looks like a bug.
// Returned as parts, not a string: the eye reads them separated by "·", but a
// screen reader announces that as "bullet" — the spoken name joins with commas.
function gapParts({ amountDelta, dayDelta }: Candidate) {
	const amount =
		amountDelta < SUB_CENT
			? "exact amount"
			: `${formatCurrency(amountDelta)} off`;
	const days =
		dayDelta === 0
			? "same day"
			: `${Math.abs(dayDelta)} day${Math.abs(dayDelta) === 1 ? "" : "s"} ${dayDelta < 0 ? "earlier" : "later"}`;
	return [amount, days];
}

// The viewer's open state lives here so every close path resets it: the detail
// popup unmounts on close, and the caller's key resets it on a receipt switch.
function ReceiptSource({
	contentType,
	id,
	imageSrc,
	vendor,
}: {
	contentType: string | null;
	id: number;
	imageSrc: string;
	vendor: string | null;
}) {
	const [viewerOpen, setViewerOpen] = useState(false);

	return (
		<>
			<ReceiptSourceThumbnail
				contentType={contentType}
				onOpen={() => setViewerOpen(true)}
				src={imageSrc}
			/>
			<ReceiptViewer
				contentType={contentType}
				onOpenChange={setViewerOpen}
				open={viewerOpen}
				receiptId={id}
				vendor={vendor}
			/>
		</>
	);
}

/**
 * The receipt→transaction link, in whichever state it's in: confirmed, ranked
 * suggestions awaiting one click, or nothing to suggest. Never links on its own
 * (adr010) — a member always confirms.
 */
function MatchBanner({
	receiptId,
	status,
	transactionId,
	transactionDescription,
}: {
	receiptId: number;
	status: ReceiptStatus;
	transactionId: number | null;
	transactionDescription: string | null;
}) {
	const utils = api.useUtils();
	const unmatched =
		transactionId === null && status === ReceiptStatus.Processed;

	// Read-time: refetched whenever the overlay opens, so a transaction another
	// member claimed in the meantime is already gone from the list.
	// The zone goes with the request: the server ranks by how many days off each
	// transaction is, and its own zone is UTC — which would disagree with the dates
	// this component renders (browser-local) by a day for anyone east of it.
	const { data: candidates, isLoading } = api.receipt.matchCandidates.useQuery(
		unmatched
			? {
					receiptId,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				}
			: skipToken,
	);

	const confirm = api.receipt.confirmMatch.useMutation({
		onSuccess: () => utils.receipt.invalidate(),
		// The unique index rejects a transaction that was claimed mid-read; say so
		// rather than leaving the click looking ignored.
		onError: (error) => toast.error(error.message),
	});

	if (transactionId !== null) {
		return (
			<p className="flex items-center gap-2 rounded-lg border border-[color:var(--badge-positive-border)] bg-[var(--badge-positive-bg)] px-3 py-2 text-[var(--badge-positive-fg)] text-sm">
				<Check aria-hidden className="h-4 w-4 shrink-0" />
				{/* min-w-0: without it a long bank description refuses to wrap and
				    pushes past the dialog edge on a phone. */}
				<span className="min-w-0">
					Matched to{" "}
					<span className="font-medium">
						{transactionDescription ?? "a transaction"}
					</span>
				</span>
			</p>
		);
	}

	// Pending/failed/duplicate rows have no total or date to match on yet.
	if (!unmatched) return null;

	if (isLoading)
		return (
			<p
				className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm"
				role="status"
			>
				<Loader2Icon aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
				Looking for a matching transaction…
			</p>
		);

	if (!candidates?.length)
		return (
			<p className="rounded-lg border border-border border-dashed bg-muted/20 px-3 py-2 text-muted-foreground text-sm">
				No transaction within 2% and 4 days of this receipt.
			</p>
		);

	return (
		<section
			aria-labelledby={`match-heading-${receiptId}`}
			className="rounded-lg border border-border bg-muted/20 p-3"
		>
			<h3
				className="font-medium text-foreground text-sm"
				id={`match-heading-${receiptId}`}
			>
				Which transaction is this?
			</h3>
			<ul className="mt-2 flex flex-col gap-1.5">
				{candidates.slice(0, MAX_SUGGESTIONS).map((c) => {
					const saving = confirm.variables?.transactionId === c.id;
					return (
						<li key={c.id}>
							<button
								aria-label={`Match to ${c.description}, ${formatDate(c.date)}, ${gapParts(c).join(", ")}`}
								className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left outline-none transition-colors hover:border-foreground/25 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
								disabled={confirm.isPending}
								onClick={() =>
									confirm.mutate({ receiptId, transactionId: c.id })
								}
								type="button"
							>
								<span className="min-w-0">
									<span className="block truncate font-medium text-foreground text-sm">
										{c.description}
									</span>
									<span className="block text-muted-foreground text-xs">
										{formatDate(c.date)} · {gapParts(c).join(" · ")}
									</span>
								</span>
								{/* Dimming alone reads as "nothing happened" on a slow link. */}
								{confirm.isPending && saving ? (
									<Loader2Icon
										aria-hidden
										className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
									/>
								) : (
									<Money
										className="shrink-0 text-sm"
										tone="spend"
										value={c.amount}
									/>
								)}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

export function ReceiptDetail({
	receiptId,
	onOpenChange,
}: {
	receiptId: number | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = receiptId !== null;
	// Kept mounted across close so Base UI can play the exit animation. Freezing
	// the last selected id keeps the query key — and its cached data — stable
	// while fading out, instead of snapping to "Receipt" + a spinner.
	const lastId = useRef(receiptId);
	if (receiptId !== null) lastId.current = receiptId;
	const { data, isLoading } = api.receipt.get.useQuery(
		{ id: lastId.current ?? 0 },
		{ enabled: open },
	);

	const imageSrc = data ? receiptImageUrl(data.id) : "";
	const mismatch = data ? itemsTotalMismatch(data.total, data.items) : false;
	// Attribution only makes sense once the receipt belongs to a transaction —
	// until then there's no spend for an item to be a slice of.
	const matched = data?.transactionId != null;

	const { data: expenses } = api.expense.list.useQuery(undefined, {
		enabled: matched,
	});
	const { data: categories } = api.category.list.useQuery(undefined, {
		enabled: matched,
	});

	const utils = api.useUtils();
	const onAttributed = {
		onSuccess: () => utils.receipt.invalidate(),
		onError: (error: { message: string }) => toast.error(error.message),
	};
	const setExpense = api.receipt.setItemExpense.useMutation(onAttributed);
	const setCategory = api.receipt.setItemCategory.useMutation(onAttributed);

	// Both lists lead with a null option so a member can undo a wrong pick, and
	// hold only managed rows — a category is chosen, never invented (glossary).
	const expenseOptions: SelectFieldOption<number | null>[] = [
		{ value: null, label: "No expense" },
		...(expenses ?? []).map((e) => ({
			value: e.id,
			label: e.name,
			// Long names truncate in the narrow picker; reveal on hover.
			title: e.name,
		})),
	];
	const categoryOptions: SelectFieldOption<number | null>[] = [
		{ value: null, label: "No category" },
		...(categories ?? []).map((c) => ({
			value: c.id,
			label: c.name,
			title: c.name,
		})),
	];

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-4xl">
				<DialogHeader>
					{/* pr-8 keeps a long vendor name clear of the corner Close button. */}
					<DialogTitle className="pr-8">
						{receiptTitle(data?.vendor ?? null)}
					</DialogTitle>
					<DialogDescription>
						{data?.receiptDate
							? `Dated ${formatDate(data.receiptDate)}`
							: "Extracted receipt detail"}
					</DialogDescription>
				</DialogHeader>

				{isLoading || !data ? (
					<div
						aria-label="Loading receipt"
						className="flex h-48 items-center justify-center text-muted-foreground"
						role="status"
					>
						<Loader2Icon aria-hidden className="h-5 w-5 animate-spin" />
					</div>
				) : (
					<div
						// min-w-0: as a grid item this defaults to min-content, so a long
						// bank description in the banner would widen it past the dialog.
						className="flex min-w-0 flex-col gap-5"
					>
						<MatchBanner
							receiptId={data.id}
							status={data.status}
							transactionDescription={data.transactionDescription}
							transactionId={data.transactionId}
						/>

						<div className="grid gap-5 sm:grid-cols-[minmax(0,11rem)_1fr]">
							{/* The receipt's ground truth, beside the extraction. Keyed so a
							    cached receipt swapped in under the open dialog starts closed
							    with a fresh thumbnail. */}
							<ReceiptSource
								contentType={data.contentType}
								id={data.id}
								imageSrc={imageSrc}
								key={data.id}
								vendor={data.vendor}
							/>

							{/* min-w-0: as a grid item this defaults to min-width:auto, so the
							    items table's w-52 picker column inflated the track instead of
							    letting overflow-x-auto engage — pickers were clipped off-screen
							    at 375px. Same fix as the matched banner above. */}
							<div className="flex min-w-0 flex-col gap-4">
								<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
									<div>
										<dt className="text-muted-foreground text-xs">Total</dt>
										<dd className="font-medium">
											{data.total != null ? (
												<Money tone="spend" value={data.total} />
											) : (
												<span className="text-muted-foreground">—</span>
											)}
											{data.currency && (
												<span className="ml-1 text-muted-foreground text-xs">
													{data.currency}
												</span>
											)}
										</dd>
									</div>
									<div>
										<dt className="text-muted-foreground text-xs">Items</dt>
										<dd className="tabular font-medium">{data.items.length}</dd>
									</div>
								</dl>

								{mismatch && (
									<Badge className="w-fit border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)]">
										<TriangleAlert aria-hidden />
										Items don't sum to the total
									</Badge>
								)}

								{data.items.length ? (
									<div className="overflow-x-auto rounded-lg border border-border">
										<table className="w-full border-collapse text-sm">
											<thead>
												<tr className="border-border border-b bg-muted/40 text-left text-muted-foreground text-xs">
													<th className="px-3 py-2 font-medium" scope="col">
														Item
													</th>
													<th
														className="px-3 py-2 text-right font-medium"
														scope="col"
													>
														Qty
													</th>
													<th
														className="px-3 py-2 text-right font-medium"
														scope="col"
													>
														Price
													</th>
													{matched && (
														<th
															className="w-52 px-3 py-2 font-medium"
															scope="col"
														>
															Attribute to
														</th>
													)}
												</tr>
											</thead>
											<tbody className="divide-y divide-border">
												{data.items.map((item) => (
													<tr key={item.id}>
														<td className="px-3 py-2">
															<span className="font-medium text-foreground">
																{item.name}
															</span>
															{/* Once pickers are up they show the category; the
															    read-only echo would just repeat them. */}
															{!matched && item.categoryName && (
																<span className="mt-0.5 block text-muted-foreground text-xs">
																	{item.categoryName}
																</span>
															)}
														</td>
														<td className="tabular px-3 py-2 text-right text-muted-foreground">
															{item.quantity}
														</td>
														<td className="px-3 py-2 text-right">
															<Money value={item.price} />
														</td>
														{matched && (
															<td className="px-3 py-2">
																<div className="flex flex-col gap-1.5">
																	<SelectField
																		aria-label={`Expense for ${item.name}`}
																		className="w-full"
																		// Gate only the row being saved — the mutation is
																		// shared, so isPending alone freezes every picker.
																		disabled={
																			setExpense.isPending &&
																			setExpense.variables?.itemId === item.id
																		}
																		items={expenseOptions}
																		onValueChange={(expenseId) =>
																			setExpense.mutate({
																				itemId: item.id,
																				expenseId,
																			})
																		}
																		placeholder="Expense…"
																		value={item.expenseId}
																	/>
																	<SelectField
																		aria-label={`Category for ${item.name}`}
																		className="w-full"
																		disabled={
																			setCategory.isPending &&
																			setCategory.variables?.itemId === item.id
																		}
																		items={categoryOptions}
																		onValueChange={(categoryId) =>
																			setCategory.mutate({
																				itemId: item.id,
																				categoryId,
																			})
																		}
																		placeholder="Category…"
																		value={item.categoryId}
																	/>
																</div>
															</td>
														)}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								) : (
									<p className="text-muted-foreground text-sm">
										No line items extracted.
									</p>
								)}

								{/* Says why the pickers aren't there yet, so their absence reads
								    as a sequence rather than a missing feature. */}
								{!matched &&
									data.items.length > 0 &&
									data.status === ReceiptStatus.Processed && (
										<p className="text-muted-foreground text-xs">
											Confirm the matching transaction to attribute items to an
											expense or category.
										</p>
									)}

								{/* Show the error only on a failed row — retry clears it, a done row never has one. */}
								{data.status === ReceiptStatus.Failed && data.error && (
									<p
										className="flex items-start gap-2 rounded-md border border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] px-3 py-2 text-[var(--badge-spend-fg)] text-xs"
										role="alert"
									>
										<TriangleAlert
											aria-hidden
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
										/>
										<span>{data.error}</span>
									</p>
								)}
							</div>
						</div>

						<MoreDetails data={data} />
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
