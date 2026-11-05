"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { applyOutcome } from "~/components/apply-progress.display";
import { ApplyToast } from "~/components/apply-toast";
import type { CurrentApply } from "~/domain/transactions";
import { api } from "~/trpc/react";

const POLL_MS = 2000;
const FINISHED_MS = 5000;

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
	const closed = useRef<number | null>(null);

	useEffect(() => {
		if (!apply) return;

		// Another tab started the next Apply before this one's end was polled.
		if (seenRunning.current !== null && seenRunning.current !== apply.id) {
			toast.dismiss(toastId(seenRunning.current));
			seenRunning.current = null;
			onFinished();
		}

		if (apply.active) {
			seenRunning.current = apply.id;

			if (closed.current === apply.id) return;

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
					duration: Number.POSITIVE_INFINITY,
					onDismiss: () => {
						closed.current = apply.id;
					},
				},
			);

			return;
		}

		if (seenRunning.current !== apply.id) return;

		seenRunning.current = null;
		onFinished();

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
				// An error asks the Member to act, so it waits for them.
				duration: outcome === "error" ? Number.POSITIVE_INFINITY : FINISHED_MS,
			},
		);
	}, [apply, onFinished]);

	return null;
}

const toastId = (applyId: number) => `apply-${applyId}`;
