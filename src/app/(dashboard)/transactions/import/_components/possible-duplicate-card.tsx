import { Fragment, type ReactNode, useId } from "react";
import { Money } from "~/components/money";
import { Button } from "~/components/ui/button";
import type {
	PossibleDuplicateReview,
	ResolveDuplicateInput,
} from "~/domain/transactions";
import { formatCurrency, formatDate } from "~/lib/utils";
import { amountGapLabel, dayGapLabel } from "./import.display";

export type DuplicateChoice = ResolveDuplicateInput["choice"];

/** Drives both the buttons and the legend above the cards, so their order can't drift. */
export const CHOICES: {
	choice: DuplicateChoice;
	label: string;
	effect: string;
}[] = [
	{ choice: "keep_mine", label: "Keep mine", effect: "drops the bank's copy." },
	{
		choice: "use_bank",
		label: "Use bank's",
		effect: "gives yours its date and amount.",
	},
	{
		choice: "both_real",
		label: "Both are real",
		effect: "adds the bank's row.",
	},
];

export function PossibleDuplicateCard({
	review: { bank, mine },
	pending,
	onResolve,
}: {
	review: PossibleDuplicateReview;
	/** The answer being saved; every button waits for it. */
	pending: DuplicateChoice | null;
	onResolve: (choice: DuplicateChoice) => void;
}) {
	const titleId = useId();
	const gaps = [
		dayGapLabel(bank.date, mine.date),
		amountGapLabel(bank.amount, mine.amount),
	].filter((gap) => gap !== null);

	return (
		<article
			aria-labelledby={titleId}
			className="overflow-hidden rounded-xl bg-card text-sm ring-1 ring-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-lg:scroll-mt-20"
			// Focus moves here once a nearby card is answered.
			tabIndex={-1}
		>
			{/* Date and amount too: many cards share a description (every Coles shop). */}
			<h3 className="sr-only" id={titleId}>
				Possible duplicate of {mine.description}, {formatDate(mine.date)},{" "}
				{formatCurrency(Math.abs(mine.amount))}
			</h3>
			<div className="grid divide-border max-sm:divide-y sm:grid-cols-2 sm:divide-x">
				<Side label="In Ledger" row={mine} />
				<Side label="From the bank" row={bank}>
					{gaps.length > 0 && (
						<ul
							aria-label="Differences"
							className="mt-2 flex flex-wrap gap-1.5"
						>
							{gaps.map((gap) => (
								<li
									className="rounded-full border border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] px-2 py-0.5 text-xs font-medium text-[var(--badge-warn-fg)]"
									key={gap}
								>
									{gap}
								</li>
							))}
						</ul>
					)}
				</Side>
			</div>
			<div className="flex flex-wrap gap-2 border-t border-border bg-muted/30 px-4 py-3">
				{CHOICES.map(({ choice, label, effect }) => (
					<Fragment key={choice}>
						<Button
							// Every card has the same three names; this says what each does, and to which row.
							aria-describedby={`${titleId}-${choice} ${titleId}`}
							disabled={pending !== null && pending !== choice}
							loading={pending === choice}
							onClick={() => onResolve(choice)}
							size="sm"
							variant="outline"
						>
							{label}
						</Button>
						{/* Hidden, so browsing the card doesn't read it; a description still can. */}
						<span hidden id={`${titleId}-${choice}`}>
							{label} {effect}
						</span>
					</Fragment>
				))}
			</div>
		</article>
	);
}

function Side({
	label,
	row,
	children,
}: {
	label: string;
	row: Pick<
		PossibleDuplicateReview["mine"],
		"date" | "amount" | "description"
	> & { accountName: string | null };
	children?: ReactNode;
}) {
	const labelId = useId();
	return (
		// biome-ignore lint/a11y/useSemanticElements: not a form, so no fieldset; a section would add two landmarks per card
		<div aria-labelledby={labelId} className="min-w-0 px-4 py-3.5" role="group">
			<p
				className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
				id={labelId}
			>
				{label}
			</p>
			<div className="mt-1.5 flex items-baseline justify-between gap-3">
				{/* Wraps, never cut: the tail is often what tells two rows apart. */}
				<p className="min-w-0 font-medium wrap-anywhere text-foreground">
					{row.description}
				</p>
				<Money
					className="shrink-0 font-medium"
					signed
					tone="ledger"
					value={row.amount}
				/>
			</div>
			<p className="mt-0.5 text-xs text-muted-foreground">
				<span className="tabular">{formatDate(row.date)}</span>
				<span aria-hidden="true"> · </span>
				<span>{row.accountName ?? "No account"}</span>
			</p>
			{children}
		</div>
	);
}
