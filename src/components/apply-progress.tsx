"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";
import {
	applyNeedsReview,
	applyOutcome,
} from "~/components/apply-progress.display";
import { ApplyToast } from "~/components/apply-toast";
import type { CurrentApply } from "~/domain/transactions";
import { api } from "~/trpc/react";

const POLL_MS = 2000;
const FINISHED_MS = 5000;
// Top, clear of the Import page's sticky Apply bar. Other toasts keep their spot.
const POSITION = "top-center";

/** Polls the latest Apply while it runs, so its toast follows the Member across pages. */
export function ApplyProgress() {
	const utils = api.useUtils();
	const { data } = api.transaction.currentApply.useQuery(undefined, {
		refetchInterval: (query) => (query.state.data?.active ? POLL_MS : false),
	});

	return (
		<ApplyToasts
			apply={data ?? null}
			onFinished={() => {
				// Applied answers add Transactions, which feed the budget.
				void utils.transaction.invalidate();
				void utils.expense.consumption.invalidate();
			}}
		/>
	);
}

/**
 * Turns each poll into a toast; renders nothing. A finish toasts only if this
 * tab saw that Apply run, so a page load never replays an old result.
 */
export function ApplyToasts({
	apply,
	onFinished,
}: {
	apply: CurrentApply | null;
	onFinished: () => void;
}) {
	const seenRunning = useRef<number | null>(null);
	const dismissedApplyId = useRef<number | null>(null);
	const finishedApplyId = useRef<number | null>(null);
	// Read when a poll lands, not as a dep: the parent passes a new arrow each render.
	const finished = useEffectEvent(onFinished);

	useEffect(() => {
		if (!apply) return;

		// Once a newer Apply shows up, the last one's finish toast is old news.
		if (
			finishedApplyId.current !== null &&
			finishedApplyId.current !== apply.id
		) {
			toast.dismiss(toastId(finishedApplyId.current));
			finishedApplyId.current = null;
		}

		// Another tab started the next Apply before this one's end was polled.
		if (seenRunning.current !== null && seenRunning.current !== apply.id) {
			toast.dismiss(toastId(seenRunning.current));
			seenRunning.current = null;
			finished();
		}

		if (apply.active) {
			seenRunning.current = apply.id;

			if (dismissedApplyId.current === apply.id) return;

			toast.custom(
				(id) => (
					<ApplyToast
						apply={apply}
						onClose={() => toast.dismiss(id)}
						phase="running"
					/>
				),
				{
					id: toastId(apply.id),
					position: POSITION,
					duration: Number.POSITIVE_INFINITY,
					onDismiss: () => {
						dismissedApplyId.current = apply.id;
					},
				},
			);

			return;
		}

		if (seenRunning.current !== apply.id) return;

		seenRunning.current = null;
		finishedApplyId.current = apply.id;
		finished();

		const outcome = applyOutcome(apply);
		toast.custom(
			(id) => (
				<ApplyToast
					apply={apply}
					onClose={() => toast.dismiss(id)}
					phase={outcome}
				/>
			),
			{
				id: toastId(apply.id),
				position: POSITION,
				duration: applyNeedsReview(apply, outcome)
					? Number.POSITIVE_INFINITY
					: FINISHED_MS,
			},
		);
	}, [apply]);

	return null;
}

const toastId = (applyId: number) => `apply-${applyId}`;
