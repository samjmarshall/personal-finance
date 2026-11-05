"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { AnswerInput } from "~/domain/transactions";
import { api } from "~/trpc/react";
import { PossibleDuplicatePiles } from "./possible-duplicate-piles";

export function PossibleDuplicateList({
	onEmptied,
}: {
	/** The last review was answered; focus needs somewhere to go. */
	onEmptied: () => void;
}) {
	const [reviews] = api.transaction.possibleDuplicates.useSuspenseQuery();
	const utils = api.useUtils();
	// Same cache the progress toast polls, so Apply waits on the running one.
	const { data: current } = api.transaction.currentApply.useQuery();
	// Offline it fails at once with a toast; paused, it would hold every answer.
	const start = api.transaction.applyAnswers.useMutation({
		networkMode: "always",
	});

	// The apply bar leaves with the last row, taking focus with it.
	const hadReviews = useRef(reviews.length > 0);
	// Read when the list changes, not as a dep: a parent re-render mid-refetch would fire it.
	const emptied = useEffectEvent(onEmptied);
	useEffect(() => {
		const had = hadReviews.current;
		hadReviews.current = reviews.length > 0;

		if (!had || reviews.length > 0) return;

		if (!document.activeElement || document.activeElement === document.body) {
			emptied();
		}
	}, [reviews]);

	async function apply(answers: AnswerInput[]) {
		try {
			const started = await start.mutateAsync({ answers });
			// The toast shows now, not on the next poll.
			utils.transaction.currentApply.setData(undefined, started);
			// The running Apply's rows leave the list; the rest refetch when it ends.
			await Promise.all([
				utils.transaction.possibleDuplicates.invalidate(),
				utils.transaction.possibleDuplicateCount.invalidate(),
			]);

			return true;
		} catch {
			// A global handler already toasts the error. On "already running",
			// another tab's Apply holds the rows: show its toast and drop them.
			await Promise.all([
				utils.transaction.currentApply.invalidate(),
				utils.transaction.possibleDuplicates.invalidate(),
				utils.transaction.possibleDuplicateCount.invalidate(),
			]);

			return false;
		}
	}

	if (!reviews.length) {
		return (
			<p className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
				Nothing to review. When an import finds a bank row that may copy one of
				yours, it shows here.
			</p>
		);
	}

	return (
		<PossibleDuplicatePiles
			onApply={apply}
			progress={current?.active ? current : null}
			reviews={reviews}
			sending={start.isPending}
		/>
	);
}
