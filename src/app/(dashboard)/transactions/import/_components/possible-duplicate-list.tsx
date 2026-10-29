"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { PossibleDuplicateReview } from "~/domain/transactions";
import { api } from "~/trpc/react";
import {
	type DuplicateChoice,
	PossibleDuplicateCard,
} from "./possible-duplicate-card";

const DONE: Record<DuplicateChoice, string> = {
	keep_mine: "Kept yours.",
	use_bank: "Yours now has the bank's date and amount.",
	both_real: "Added the bank's row too.",
};

export function PossibleDuplicateList({
	onEmptied,
}: {
	/** The last card was answered; focus needs somewhere to go. */
	onEmptied: () => void;
}) {
	const [reviews] = api.transaction.possibleDuplicates.useSuspenseQuery();
	const list = useRef<HTMLUListElement>(null);
	// The answered card leaves and the next one takes its place; focus goes there, not the top.
	const answeredAt = useRef<number | null>(null);
	useEffect(() => {
		const at = answeredAt.current;
		if (at === null) return;
		answeredAt.current = null;
		const next = list.current?.querySelectorAll<HTMLElement>(
			":scope > li > article",
		)[Math.min(at, reviews.length - 1)];
		if (next) next.focus();
		else onEmptied();
	}, [reviews, onEmptied]);

	if (!reviews.length)
		return (
			<p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
				Nothing to review.
			</p>
		);
	return (
		<ul className="space-y-3" ref={list}>
			{reviews.map((review, index) => (
				<li key={review.id}>
					<ReviewItem
						onAnswered={() => {
							answeredAt.current = index;
						}}
						review={review}
					/>
				</li>
			))}
		</ul>
	);
}

// One mutation per card, so answering one card never holds another.
function ReviewItem({
	review,
	onAnswered,
}: {
	review: PossibleDuplicateReview;
	onAnswered: () => void;
}) {
	const utils = api.useUtils();
	// An answer changes rows, totals, the header badge and the review list, so refetch all.
	const refresh = () =>
		Promise.all([
			utils.transaction.invalidate(),
			utils.expense.consumption.invalidate(),
		]);
	const resolve = api.transaction.resolveDuplicate.useMutation({
		onSuccess: async (_, { choice }) => {
			toast.success(DONE[choice]);
			onAnswered();
			await refresh();
		},
		// Likely answered in another tab; the refetch drops the stale card (toast: src/trpc/query-client.ts).
		onError: () => refresh(),
	});
	return (
		<PossibleDuplicateCard
			onResolve={(choice) => resolve.mutate({ id: review.id, choice })}
			pending={resolve.isPending ? resolve.variables.choice : null}
			review={review}
		/>
	);
}
