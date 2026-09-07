"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { fortnightAnchorSetDto } from "~/domain/settings";
import { api } from "~/trpc/react";

export function PayCycleSection() {
	const utils = api.useUtils();
	const [anchor] = api.setting.fortnightAnchor.useSuspenseQuery();
	// Seeded straight from the query, not through toDateInput: the value already is a
	// YYYY-MM-DD calendar date, and re-parsing it to a Date reads it as UTC midnight,
	// walking behind-UTC members back a day before they've touched anything.
	const [value, setValue] = useState(anchor ?? "");
	// Client-side validation only. Server failures are the global MutationCache's
	// job (src/trpc/query-client.ts) — routing them here too would double-report
	// and, worse, set aria-invalid on a date that's actually fine.
	const [error, setError] = useState<string | null>(null);

	const save = api.setting.setFortnightAnchor.useMutation({
		onSuccess: async () => {
			// The anchor re-grids the fortnight buckets, so the chart is stale too.
			await Promise.all([
				utils.setting.fortnightAnchor.invalidate(),
				utils.cashflow.get.invalidate(),
			]);
			toast.success("Pay cycle saved");
		},
	});

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const parsed = fortnightAnchorSetDto.safeParse({ value });
		// Guarding here as well as on the server: a value that fails to parse would be
		// written, then read back as null, silently dropping the grid to months.
		if (!parsed.success) return setError("Please enter a valid date.");
		save.mutate(parsed.data);
	}

	return (
		<section>
			<h2 className="font-semibold text-base text-foreground tracking-tight">
				Pay cycle
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">
				The payday your fortnight buckets are counted from. Cash flow groups
				every fortnight forward and back from this date.
			</p>

			<form className="mt-5 max-w-sm" onSubmit={onSubmit}>
				<Field>
					<FieldLabel htmlFor="fortnight-anchor">Anchor payday</FieldLabel>
					<div className="flex gap-2">
						<Input
							aria-describedby={error ? "fortnight-anchor-error" : undefined}
							aria-invalid={error ? true : undefined}
							className="flex-1"
							disabled={save.isPending}
							id="fortnight-anchor"
							onChange={(e) => {
								setValue(e.target.value);
								// Stale error text plus aria-invalid would mislead a screen
								// reader once they start correcting.
								if (error) setError(null);
							}}
							type="date"
							value={value}
						/>
						<Button
							className="w-14"
							disabled={save.isPending || value === anchor}
							type="submit"
						>
							{save.isPending ? (
								<Loader2Icon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								"Save"
							)}
						</Button>
					</div>
				</Field>
				{error && (
					<p
						className="mt-2 text-destructive text-sm"
						id="fortnight-anchor-error"
						role="alert"
					>
						{error}
					</p>
				)}
			</form>
		</section>
	);
}
