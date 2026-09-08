"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { cn, formatCurrency, formatDate } from "~/lib/utils";
import { api } from "~/trpc/react";

export function BalanceSnapshotCard() {
	const utils = api.useUtils();
	const [latest] = api.balance.latest.useSuspenseQuery();
	const [amount, setAmount] = useState("");
	// Client-side validation only. Server failures are the global MutationCache's
	// job (src/trpc/query-client.ts) — routing them here too would double-report
	// and, worse, set aria-invalid on an amount that's actually fine.
	const [error, setError] = useState<string | null>(null);

	const set = api.balance.set.useMutation({
		onSuccess: async () => {
			// Re-anchor the projection: the balance line pivots on this snapshot.
			await Promise.all([
				utils.balance.latest.invalidate(),
				utils.cashflow.get.invalidate(),
			]);
			setAmount("");
		},
	});

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const value = Number.parseFloat(amount);
		// No lower bound: a household balance can be overdrawn (negative).
		if (Number.isNaN(value)) return setError("Please enter a valid amount.");
		set.mutate({ amount: value, asOf: new Date() });
	}

	return (
		<div>
			<h2 className="font-semibold text-foreground text-sm">Balance</h2>
			<p className="mb-4 text-muted-foreground text-xs">
				Anchors the projected balance line
			</p>

			{latest ? (
				<div>
					<p
						className={cn(
							"tabular font-semibold text-2xl tracking-tight",
							latest.amount < 0 ? "text-spend" : "text-foreground",
						)}
					>
						{formatCurrency(latest.amount)}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						As of {formatDate(latest.asOf)}
					</p>
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					Set your balance to anchor the projection.
				</p>
			)}

			<form className="mt-4" onSubmit={onSubmit}>
				<Field>
					<FieldLabel htmlFor="balance-amount">Update balance</FieldLabel>
					<div className="flex gap-2">
						<Input
							aria-describedby={error ? "balance-error" : undefined}
							aria-invalid={error ? true : undefined}
							className="flex-1"
							disabled={set.isPending}
							id="balance-amount"
							inputMode="decimal"
							onChange={(e) => {
								setAmount(e.target.value);
								// Clear a prior validation error once they start correcting —
								// stale error text + aria-invalid would mislead a screen reader.
								if (error) setError(null);
							}}
							placeholder="0.00"
							step="0.01"
							type="number"
							value={amount}
						/>
						<Button
							className="w-14"
							// Guards the empty field, not a repeat amount: a snapshot is
							// stamped asOf now, so re-saving an unchanged balance is a real
							// action — it re-anchors the projection to today.
							disabled={set.isPending || amount === ""}
							type="submit"
						>
							{set.isPending ? (
								<Loader2Icon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								"Save"
							)}
						</Button>
					</div>
					<FieldError id="balance-error">{error}</FieldError>
				</Field>
			</form>
		</div>
	);
}
