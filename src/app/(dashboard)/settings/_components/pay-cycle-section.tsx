"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { fortnightAnchorSetDto } from "~/domain/settings";
import { api } from "~/trpc/react";
import { SettingsSection } from "./settings-section";

export function PayCycleSection() {
	const utils = api.useUtils();
	const [anchor] = api.setting.fortnightAnchor.useSuspenseQuery();
	// Seeded straight from the query, not through toDateInput: the value already is a
	// YYYY-MM-DD calendar date, and re-parsing it to a Date reads it as UTC midnight,
	// walking behind-UTC members back a day before they've touched anything.
	const [draft, setDraft] = useState(anchor ?? "");
	// Client-side validation only. Server failures are the global MutationCache's
	// job (src/trpc/query-client.ts) — routing them here too would double-report
	// and, worse, set aria-invalid on a date that's actually fine.
	const [error, setError] = useState<string | null>(null);

	const setFortnightAnchor = api.setting.setFortnightAnchor.useMutation({
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
		const parsed = fortnightAnchorSetDto.safeParse({ anchor: draft });
		// Guarding here as well as on the server: a value that fails to parse would be
		// written, then read back as null, silently dropping the grid to months.
		if (!parsed.success) return setError("Please enter a valid date.");
		setFortnightAnchor.mutate(parsed.data);
	}

	return (
		<SettingsSection
			description="The payday your fortnight buckets are counted from. Cash flow groups every fortnight forward and back from this date."
			title="Pay cycle"
		>
			<form className="mt-5 max-w-sm" onSubmit={onSubmit}>
				<Field>
					<FieldLabel htmlFor="fortnight-anchor">Anchor payday</FieldLabel>
					<div className="flex gap-2">
						<Input
							aria-describedby={error ? "fortnight-anchor-error" : undefined}
							aria-invalid={error ? true : undefined}
							className="flex-1"
							disabled={setFortnightAnchor.isPending}
							id="fortnight-anchor"
							onChange={(e) => {
								setDraft(e.target.value);
								// Stale error text plus aria-invalid would mislead a screen
								// reader once they start correcting.
								if (error) setError(null);
							}}
							type="date"
							value={draft}
						/>
						<Button
							className="w-14"
							disabled={setFortnightAnchor.isPending || draft === anchor}
							type="submit"
						>
							{setFortnightAnchor.isPending ? (
								<Loader2Icon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								"Save"
							)}
						</Button>
					</div>
					<FieldError id="fortnight-anchor-error">{error}</FieldError>
				</Field>
			</form>
		</SettingsSection>
	);
}
