"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Money } from "~/components/money";
import { Button } from "~/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import type {
	PossibleDuplicateReview,
	ResolveDuplicateInput,
} from "~/domain/transactions";
import { cn, formatCount, formatCurrency, formatDate } from "~/lib/utils";
import {
	amountGapLabel,
	CHOICES,
	type DuplicateChoice,
	type DuplicatePile,
	dayGapLabel,
	duplicatePiles,
	fillLabel,
} from "./import.display";

type Staged = Partial<Record<number, DuplicateChoice>>;

export function PossibleDuplicatePiles({
	reviews,
	applying,
	onApply,
}: {
	reviews: PossibleDuplicateReview[];
	/** An apply is saving; the answers wait for it. */
	applying: boolean;
	/** Saves the picks. False when it failed, so they stay for another try. */
	onApply: (answers: ResolveDuplicateInput[]) => Promise<boolean>;
}) {
	const [staged, setStaged] = useState<Staged>({});
	const legendId = useId();
	const piles = duplicatePiles(reviews);
	// A pick for a row that has since gone (another tab, a re-import) is dropped here.
	const answers = reviews.flatMap(({ id }) => {
		const choice = staged[id];
		return choice ? [{ id, choice }] : [];
	});

	function pick(id: number, choice: DuplicateChoice | null) {
		setStaged((current) => {
			const next = { ...current };
			if (choice) next[id] = choice;
			else delete next[id];
			return next;
		});
	}

	function fill({ reviews: rows, suggestion }: DuplicatePile) {
		setStaged((current) => {
			const next = { ...current };
			for (const { id } of rows) next[id] ??= suggestion;
			return next;
		});
	}

	async function apply() {
		const sent = answers;
		if (!(await onApply(sent))) return;
		// A taken row stays to review; its pick failed, so it starts blank again.
		setStaged((current) => {
			const next = { ...current };
			for (const { id } of sent) delete next[id];
			return next;
		});
	}

	return (
		<>
			<p className="mt-1 text-sm text-pretty text-muted-foreground">
				These bank rows look like ones you already have. Pick an answer on each
				row, then apply them all at once.
			</p>
			<ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
				{CHOICES.map(({ choice, label, effect }) => (
					<li id={`${legendId}-${choice}`} key={choice}>
						<span className="font-medium text-foreground">{label}</span>{" "}
						{effect}
					</li>
				))}
			</ul>

			<div className="mt-4 space-y-4">
				{piles.map((pile) => (
					<Pile
						applying={applying}
						key={pile.key}
						legendId={legendId}
						onFill={() => fill(pile)}
						onPick={pick}
						pile={pile}
						staged={staged}
					/>
				))}
			</div>

			<div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-card/95 px-4 py-3 shadow-lg ring-1 ring-foreground/10 backdrop-blur-sm">
				<p
					aria-atomic="true"
					aria-live="polite"
					className="tabular text-sm text-muted-foreground"
				>
					<span className="font-medium text-foreground">
						{formatCount(answers.length)}
					</span>{" "}
					of {formatCount(reviews.length)} answered
				</p>
				<div className="ml-auto flex gap-2">
					<Button
						disabled={answers.length === 0 || applying}
						// Stays in tab order once empty, so focus never drops to the page.
						focusableWhenDisabled
						onClick={() => setStaged({})}
						size="sm"
						variant="ghost"
					>
						Clear
					</Button>
					<Button
						disabled={answers.length === 0}
						focusableWhenDisabled
						loading={applying}
						onClick={apply}
						size="sm"
					>
						Apply {formatCount(answers.length)}{" "}
						{answers.length === 1 ? "answer" : "answers"}
					</Button>
				</div>
			</div>
		</>
	);
}

function Pile({
	pile,
	staged,
	applying,
	legendId,
	onPick,
	onFill,
}: {
	pile: DuplicatePile;
	staged: Staged;
	applying: boolean;
	legendId: string;
	onPick: (id: number, choice: DuplicateChoice | null) => void;
	onFill: () => void;
}) {
	const whyId = useId();
	const unanswered = pile.reviews.filter(({ id }) => !staged[id]).length;
	const suggestion = CHOICES.find((c) => c.choice === pile.suggestion);

	return (
		// Sized by its own width, not the screen's: the sidebar takes 16rem from lg up.
		<Collapsible
			className="@container/pile overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
			defaultOpen
		>
			{/* No rule under a closed pile: the card edge is right there. */}
			<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border bg-muted/30 px-3 py-3 has-[[aria-expanded=false]]:border-b-0 @lg/pile:px-4">
				<div className="min-w-0">
					<h3>
						<CollapsibleTrigger
							aria-describedby={whyId}
							className="group -mx-1 flex items-center gap-1.5 rounded-md px-1 text-left text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							<ChevronRight
								aria-hidden
								className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
							/>
							{pile.title}
							<span className="tabular font-normal text-muted-foreground">
								<span aria-hidden="true"> · </span>
								<span className="sr-only">, </span>
								{formatCount(pile.reviews.length)}
							</span>
						</CollapsibleTrigger>
					</h3>
					<p
						className="mt-0.5 pl-5.5 text-xs text-pretty text-muted-foreground"
						id={whyId}
					>
						{pile.why}
					</p>
				</div>
				<Button
					disabled={unanswered === 0 || applying}
					focusableWhenDisabled
					onClick={onFill}
					size="sm"
					variant="outline"
				>
					<Sparkles aria-hidden />
					{fillLabel(suggestion?.label ?? "", unanswered, pile.reviews.length)}
				</Button>
			</div>
			<CollapsibleContent>
				<div
					aria-hidden
					className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_17.5rem] gap-x-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground @4xl/pile:grid"
				>
					<span>Yours</span>
					<span>From the bank</span>
					<span>Difference</span>
					<span>Answer</span>
				</div>
				<ul className="divide-y divide-border">
					{pile.reviews.map((review) => (
						<Row
							answer={staged[review.id] ?? null}
							applying={applying}
							key={review.id}
							legendId={legendId}
							onPick={(choice) => onPick(review.id, choice)}
							review={review}
						/>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

function Row({
	review: { id, bank, mine },
	answer,
	applying,
	legendId,
	onPick,
}: {
	review: PossibleDuplicateReview;
	answer: DuplicateChoice | null;
	applying: boolean;
	legendId: string;
	onPick: (choice: DuplicateChoice | null) => void;
}) {
	const dayGap = dayGapLabel(bank.date, mine.date);
	const amountGap = amountGapLabel(bank.amount, mine.amount);
	const gaps = [dayGap, amountGap].filter((gap) => gap !== null);
	// Safari passes a label click on with detail 0, so mark the press instead.
	const pressed = useRef(false);

	return (
		<li
			className={cn(
				// Stacked, then the two sides abreast, then difference beside the answer, then a table row.
				"grid items-start gap-x-4 gap-y-3 px-3 py-3 text-sm transition-colors @lg/pile:grid-cols-2 @lg/pile:px-4 @4xl/pile:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_17.5rem] @4xl/pile:py-2.5",
				answer && "bg-primary/5",
			)}
		>
			<Side label="Yours" row={mine} />
			<Side
				amountDiffers={amountGap !== null}
				dateDiffers={dayGap !== null}
				label="From the bank"
				row={bank}
			/>
			<div className="@lg/pile:col-span-2 @2xl/pile:col-span-1">
				<p className="sr-only">Difference</p>
				{gaps.length > 0 ? (
					<ul className="flex flex-wrap gap-1.5 @4xl/pile:flex-col @4xl/pile:items-start">
						{gaps.map((gap) => (
							<li
								className="rounded-full border border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] px-2 py-0.5 text-xs font-medium text-[var(--badge-warn-fg)]"
								key={gap}
							>
								{gap}
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-muted-foreground">
						Only the wording differs
					</p>
				)}
			</div>
			<fieldset
				className="min-w-0 @lg/pile:col-span-2 @2xl/pile:col-span-1"
				disabled={applying}
			>
				{/* Date and amount too: many rows share a description (every Coles shop). */}
				<legend className="sr-only">
					Answer for {mine.description}, {formatDate(mine.date)},{" "}
					{formatCurrency(Math.abs(mine.amount))}
				</legend>
				<div className="flex w-full rounded-lg bg-muted p-0.5">
					{CHOICES.map(({ choice, label }) => (
						<label
							className="relative flex-1 cursor-pointer rounded-md px-2 py-1 text-center text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors select-none hover:text-foreground has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-60 motion-reduce:transition-none"
							key={choice}
							onPointerDown={() => {
								pressed.current = true;
							}}
						>
							<input
								aria-describedby={`${legendId}-${choice}`}
								checked={answer === choice}
								// Tabbing down stops short of the apply bar, not under it.
								className="sr-only scroll-mb-32"
								name={`answer-${id}`}
								onChange={() => onPick(choice)}
								// A second click on the picked answer clears it; from the keyboard, Delete.
								// Not Space or a screen reader: a radio they pick stays picked.
								onClick={() => {
									if (pressed.current && answer === choice) onPick(null);
									pressed.current = false;
								}}
								onKeyDown={(event) => {
									if (
										answer === choice &&
										(event.key === "Delete" || event.key === "Backspace")
									) {
										event.preventDefault();
										onPick(null);
									}
								}}
								type="radio"
								value={choice}
							/>
							{label}
						</label>
					))}
				</div>
			</fieldset>
		</li>
	);
}

function Side({
	label,
	row,
	dateDiffers = false,
	amountDiffers = false,
}: {
	label: string;
	row: Pick<
		PossibleDuplicateReview["mine"],
		"date" | "amount" | "description"
	> & { accountName: string | null };
	dateDiffers?: boolean;
	amountDiffers?: boolean;
}) {
	const differs = "font-medium text-[var(--badge-warn-fg)]";
	return (
		<div className="min-w-0">
			{/* The column header says this on wide screens. */}
			<p className="mb-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase @4xl/pile:sr-only">
				{label}
			</p>
			{/* Wraps, never cut: the tail is often what tells two rows apart. */}
			<p className="font-medium wrap-anywhere text-foreground">
				{row.description}
			</p>
			<p className="mt-0.5 text-xs text-muted-foreground">
				<span className={cn("tabular", dateDiffers && differs)}>
					{formatDate(row.date)}
				</span>
				<span aria-hidden="true"> · </span>
				<Money
					className={cn(amountDiffers && differs)}
					signed
					tone="ledger"
					value={row.amount}
				/>
				<span aria-hidden="true"> · </span>
				<span>{row.accountName ?? "No account"}</span>
			</p>
		</div>
	);
}
