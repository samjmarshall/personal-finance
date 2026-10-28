"use client";

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
	onResolved,
}: {
	onResolved: () => void;
}) {
	const [reviews] = api.transaction.possibleDuplicates.useSuspenseQuery();

	if (!reviews.length)
		return (
			<p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
				Nothing to review.
			</p>
		);
	return (
		<ul className="space-y-3">
			{reviews.map((review) => (
				<li key={review.id}>
					<ReviewItem onResolved={onResolved} review={review} />
				</li>
			))}
		</ul>
	);
}

// One mutation per card, so answering one card never holds another.
function ReviewItem({
	review,
	onResolved,
}: {
	review: PossibleDuplicateReview;
	onResolved: () => void;
}) {
	const utils = api.useUtils();
	// Every transaction query: the list, totals, the header badge and this list all move.
	const refresh = () =>
		Promise.all([
			utils.transaction.invalidate(),
			utils.expense.consumption.invalidate(),
		]);
	const resolve = api.transaction.resolveDuplicate.useMutation({
		onSuccess: async (_, { choice }) => {
			toast.success(DONE[choice]);
			await refresh();
			onResolved();
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
