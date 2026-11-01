"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
	RESOLVE_DUPLICATES_MAX,
	type ResolveDuplicateInput,
} from "~/domain/transactions";
import { api } from "~/trpc/react";
import { appliedLabel } from "./import.display";
import { PossibleDuplicatePiles } from "./possible-duplicate-piles";

export function PossibleDuplicateList({
	onEmptied,
}: {
	/** The last review was answered; focus needs somewhere to go. */
	onEmptied: () => void;
}) {
	const [reviews] = api.transaction.possibleDuplicates.useSuspenseQuery();
	const utils = api.useUtils();
	// Offline it fails at once with a toast; paused, it would hold every answer.
	const resolve = api.transaction.resolveDuplicates.useMutation({
		networkMode: "always",
	});
	// Own flag, not isPending: a big apply is several calls, and it dips between them.
	const [applying, setApplying] = useState(false);

	// The apply bar leaves with the last row, taking focus with it.
	const hadReviews = useRef(reviews.length > 0);
	// Read when the list changes, not as a dep: a parent re-render mid-refetch would fire it.
	const emptied = useEffectEvent(onEmptied);
	useEffect(() => {
		const had = hadReviews.current;
		hadReviews.current = reviews.length > 0;
		if (!had || reviews.length > 0) return;
		if (!document.activeElement || document.activeElement === document.body)
			emptied();
	}, [reviews]);

	async function apply(answers: ResolveDuplicateInput[]) {
		setApplying(true);
		const tally = { resolved: 0, gone: 0, taken: 0 };
		try {
			for (let at = 0; at < answers.length; at += RESOLVE_DUPLICATES_MAX) {
				const done = await resolve.mutateAsync({
					answers: answers.slice(at, at + RESOLVE_DUPLICATES_MAX),
				});
				tally.resolved += done.resolved;
				tally.gone += done.gone;
				tally.taken += done.taken;
			}
			if (tally.gone > 0 || tally.taken > 0) toast.warning(appliedLabel(tally));
			else toast.success(appliedLabel(tally));
			return true;
		} catch {
			// Toast: src/trpc/query-client.ts.
			return false;
		} finally {
			// An answer changes rows, totals, the header badge and the review list, so refetch all.
			await Promise.all([
				utils.transaction.invalidate(),
				utils.expense.consumption.invalidate(),
			]);
			setApplying(false);
		}
	}

	if (!reviews.length)
		return (
			<p className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
				Nothing to review.
			</p>
		);
	return (
		<PossibleDuplicatePiles
			applying={applying}
			onApply={apply}
			reviews={reviews}
		/>
	);
}
