import type { CurrentApply, DuplicateApply } from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { formatCount } from "~/lib/utils";

/** How a finished Apply ends: `error` when it failed or stuck, `warning` when some didn't land. */
export type ApplyOutcome = "success" | "warning" | "error";

type Counts = Pick<CurrentApply, "total" | "pending">;

/** The toast after an apply. A taken review stays, so it still needs an answer. */
export function appliedLabel({
	applied,
	gone,
	taken,
}: Pick<DuplicateApply, "applied" | "gone" | "taken">): string {
	const parts: string[] = [];

	if (applied > 0) {
		parts.push(
			`Applied ${formatCount(applied)} ${applied === 1 ? "answer" : "answers"}.`,
		);
	}

	if (gone > 0) {
		parts.push(`${formatCount(gone)} no longer needed an answer.`);
	}

	if (taken > 0) {
		parts.push(
			`${formatCount(taken)} still ${taken === 1 ? "needs" : "need"} an answer: the bank's row is already in your transactions.`,
		);
	}

	return parts.join(" ");
}

export function applyProgressLabel({ total, pending }: Counts): string {
	return `${formatCount(total - pending)} of ${formatCount(total)}`;
}

export function applyStoppedLabel({ total, pending }: Counts): string {
	const answers = pending === 1 ? "answer" : "answers";

	return `Stopped at ${applyProgressLabel({ total, pending })}. ${formatCount(pending)} ${answers} didn't apply.`;
}

export function applyOutcome({
	status,
	active,
	gone,
	taken,
}: Pick<CurrentApply, "status" | "active" | "gone" | "taken">): ApplyOutcome {
	if (status === DuplicateApplyStatus.Failed) return "error";
	if (status === DuplicateApplyStatus.Running && !active) return "error";
	if (gone > 0 || taken > 0) return "warning";

	return "success";
}
