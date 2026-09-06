"use client";

import { FileText, Loader2Icon, TriangleAlert } from "lucide-react";

import { Money } from "~/app/_components/money";
import { Badge } from "~/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { itemsTotalMismatch } from "~/domain/receipts/receipt-total";
import { formatDate } from "~/lib/utils";
import { api } from "~/trpc/react";

// A processed receipt with no vendor is still worth opening (the image is the
// source of truth); fall back to a neutral title rather than blank.
function titleFor(vendor: string | null) {
	return vendor?.trim() ? vendor : "Receipt";
}

export function ReceiptDetail({
	receiptId,
	onOpenChange,
}: {
	receiptId: number | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = receiptId !== null;
	// Kept mounted across close so Base UI can play the exit animation; the query
	// only runs while a row is selected.
	const { data, isLoading } = api.receipt.get.useQuery(
		{ id: receiptId ?? 0 },
		{ enabled: open },
	);

	const isPdf = data?.contentType === "application/pdf";
	const imageSrc = data ? `/api/receipts/${data.id}/image` : "";
	const mismatch = data ? itemsTotalMismatch(data.total, data.items) : false;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{data ? titleFor(data.vendor) : "Receipt"}</DialogTitle>
					<DialogDescription>
						{data?.receiptDate
							? `Dated ${formatDate(data.receiptDate)}`
							: "Extracted receipt detail"}
					</DialogDescription>
				</DialogHeader>

				{isLoading || !data ? (
					<div className="flex h-48 items-center justify-center text-muted-foreground">
						<Loader2Icon className="h-5 w-5 animate-spin" />
					</div>
				) : (
					<div className="grid gap-5 sm:grid-cols-[minmax(0,11rem)_1fr]">
						{/* Source image — the receipt's ground truth, beside the extraction. */}
						<div className="overflow-hidden rounded-lg border border-border bg-muted/40">
							{isPdf ? (
								<a
									className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground text-xs hover:text-foreground"
									href={imageSrc}
									rel="noreferrer"
									target="_blank"
								>
									<FileText className="h-8 w-8" />
									Open PDF
								</a>
							) : (
								// biome-ignore lint/performance/noImgElement: private-blob proxy, not a static asset for next/image
								<img
									alt={`Receipt from ${titleFor(data.vendor)}`}
									className="h-auto w-full object-contain"
									loading="lazy"
									src={imageSrc}
								/>
							)}
						</div>

						<div className="flex flex-col gap-4">
							<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<div>
									<dt className="text-muted-foreground text-xs">Total</dt>
									<dd className="font-medium">
										<Money tone="spend" value={data.total} />
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
									<TriangleAlert />
									Items don't sum to the total
								</Badge>
							)}

							{data.items.length ? (
								<div className="overflow-hidden rounded-lg border border-border">
									<table className="w-full border-collapse text-sm">
										<thead>
											<tr className="border-border border-b bg-muted/40 text-left text-muted-foreground text-xs">
												<th className="px-3 py-2 font-medium">Item</th>
												<th className="px-3 py-2 text-right font-medium">
													Qty
												</th>
												<th className="px-3 py-2 text-right font-medium">
													Price
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-border">
											{data.items.map((item) => (
												<tr key={item.id}>
													<td className="px-3 py-2">
														<span className="font-medium text-foreground">
															{item.name}
														</span>
														{item.expenseCategoryName && (
															<span className="mt-0.5 block text-muted-foreground text-xs">
																{item.expenseCategoryName}
															</span>
														)}
													</td>
													<td className="tabular px-3 py-2 text-right text-muted-foreground">
														{item.quantity}
													</td>
													<td className="px-3 py-2 text-right">
														<Money value={item.price} />
													</td>
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

							{data.error && (
								<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-spend text-xs">
									{data.error}
								</p>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
