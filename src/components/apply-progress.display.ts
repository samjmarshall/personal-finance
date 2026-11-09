import type { CurrentApply, DuplicateApply } from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { formatCount } from "~/lib/utils";

/** How a finished Apply ends: stopped with Answers left, partly landed, or all landed. */
export type ApplyOutcome = "success" | "warning" | "error";

type Counts = Pick<CurrentApply, "total" | "pending">;

/** A taken review stays pending, so it still needs an Answer. */
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
	pending,
	gone,
	taken,
}: Pick<
	CurrentApply,
	"status" | "active" | "pending" | "gone" | "taken"
>): ApplyOutcome {
	const stopped =
		status === DuplicateApplyStatus.Failed ||
		(status === DuplicateApplyStatus.Running && !active);

	// Stopped after its last Answer: nothing is left for the Member to redo.
	if (stopped && pending > 0) return "error";
	if (gone > 0 || taken > 0) return "warning";

	return "success";
}
