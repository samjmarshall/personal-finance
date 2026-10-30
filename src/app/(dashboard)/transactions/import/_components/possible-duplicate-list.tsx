"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import type { PossibleDuplicateReview } from "~/domain/transactions";
import { formatCount } from "~/lib/utils";
import { api } from "~/trpc/react";
import {
	CHOICES,
	type DuplicateChoice,
	PossibleDuplicateCard,
} from "./possible-duplicate-card";

const PAGE_SIZE = 25;

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
	// A card can also leave on a refetch (a run ended, another tab answered it); focus follows it too.
	const lastFocused = useRef<{ id: number; index: number } | null>(null);
	// Read when the list changes, not as a dep: a parent re-render mid-refetch would focus the leaving card.
	const emptied = useEffectEvent(onEmptied);
	useEffect(() => {
		const last = lastFocused.current;
		const at =
			answeredAt.current ??
			(last && !reviews.some((r) => r.id === last.id) ? last.index : null);
		if (at === null) return;
		answeredAt.current = null;
		lastFocused.current = null;
		// Only pick focus up if it fell to the page: a card that stayed keeps it.
		if (document.activeElement && document.activeElement !== document.body)
			return;
		const next = list.current?.querySelectorAll<HTMLElement>(
			":scope > li > article",
		)[Math.min(at, reviews.length - 1)];
		if (next) next.focus();
		else emptied();
	}, [reviews]);

	// A long import can leave hundreds; all at once is a very long page and tab order.
	const [shown, setShown] = useState(PAGE_SIZE);
	const hidden = reviews.length - shown;
	function showMore() {
		// The button moves below the new cards, so focus goes to the first of them.
		flushSync(() => setShown((count) => count + PAGE_SIZE));
		list.current
			?.querySelectorAll<HTMLElement>(":scope > li > article")
			[shown]?.focus();
	}

	if (!reviews.length)
		return (
			<p className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
				Nothing to review.
			</p>
		);
	return (
		<>
			<p className="mt-1 text-sm text-pretty text-muted-foreground">
				These bank rows look like ones you already have, but not exactly.
			</p>
			<ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
				{CHOICES.map(({ choice, label, effect }) => (
					<li key={choice}>
						<span className="font-medium text-foreground">{label}</span>{" "}
						{effect}
					</li>
				))}
			</ul>
			<ul className="mt-4 space-y-3" ref={list}>
				{reviews.slice(0, shown).map((review, index) => (
					<li
						key={review.id}
						onFocus={() => {
							lastFocused.current = { id: review.id, index };
						}}
					>
						<ReviewItem
							onAnswered={() => {
								answeredAt.current = index;
							}}
							review={review}
						/>
					</li>
				))}
			</ul>
			{hidden > 0 && (
				<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
					<Button onClick={showMore} variant="outline">
						Show {formatCount(Math.min(hidden, PAGE_SIZE))} more
					</Button>
					<p className="tabular text-sm text-muted-foreground">
						Showing {formatCount(shown)} of {formatCount(reviews.length)}
					</p>
				</div>
			)}
		</>
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
		onError: () => {
			onAnswered();
			return refresh();
		},
	});
	return (
		<PossibleDuplicateCard
			onResolve={(choice) => resolve.mutate({ id: review.id, choice })}
			pending={resolve.isPending ? resolve.variables.choice : null}
			review={review}
		/>
	);
}
