import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
	AnswerInput,
	CurrentApply,
	PossibleDuplicateReview,
} from "~/domain/transactions";
import { Answer, Provenance } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import { PossibleDuplicatePiles } from "./possible-duplicate-piles";

// Bank days are UTC midnight; yours are Sydney midnight (13:00 UTC the day before, AEDT).
function review(
	id: number,
	description: string,
	{
		bank,
		mine,
		days = 0,
		score = null,
	}: { bank: number; mine: number; days?: number; score?: number | null },
): PossibleDuplicateReview {
	return {
		id,
		bank: {
			date: new Date(Date.UTC(2026, 1, 1 + days)),
			amount: bank,
			description: `BANK ${description.toUpperCase()}`,
			accountName: "Everyday",
		},
		mine: {
			id: id + 100,
			date: new Date("2026-01-31T13:00:00.000Z"),
			amount: mine,
			description,
			accountName: null,
			provenance: Provenance.Manual,
		},
		descriptionScore: score,
		answer: null,
		notApplied: false,
	};
}

// The bank's description is yours in capitals after "BANK"; the score picks the pile.
const COFFEE = review(1, "Coffee Club Brisbane", {
	bank: 5,
	mine: 5,
	days: 2,
	score: 0.9,
});
const GROCERIES = review(2, "Coles Groceries Redcliffe", {
	bank: 80,
	mine: 80,
	days: 1,
	score: 0.8,
});
const VERCEL = review(3, "Vercel", { bank: 30, mine: 30, score: 0.2 });
const REVIEWS = [COFFEE, GROCERIES, VERCEL];

function renderPiles({
	reviews = REVIEWS,
	sending = false,
	progress = null,
	saved = true,
}: {
	reviews?: PossibleDuplicateReview[];
	sending?: boolean;
	progress?: Pick<CurrentApply, "total" | "pending"> | null;
	saved?: boolean;
} = {}) {
	const onApply = vi.fn(async (_: AnswerInput[]) => saved);
	render(
		<PossibleDuplicatePiles
			onApply={onApply}
			progress={progress}
			reviews={reviews}
			sending={sending}
		/>,
	);

	return { onApply, user: userEvent.setup() };
}

const answerFor = (description: string) =>
	screen.getByRole("group", {
		name: new RegExp(`^Answer for ${description}`),
	});

describe("PossibleDuplicatePiles", () => {
	it("puts similar descriptions in the first pile and different ones last", () => {
		renderPiles();

		const piles = screen.getAllByRole("heading", { level: 3 });
		expect(piles.map((pile) => pile.textContent)).toEqual([
			"Similar description · , 2",
			"Different description · , 1",
		]);
		expect(
			screen.getByText(
				"The descriptions match. Almost always the same purchase.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"The descriptions don't match. Most likely two purchases.",
			),
		).toBeInTheDocument();
	});

	it("says when only the wording differs", () => {
		renderPiles({ reviews: [VERCEL] });

		expect(screen.getByText("Only the wording differs")).toBeInTheDocument();
	});

	it("still shows an amount yours was edited to after the flag", () => {
		renderPiles({
			reviews: [review(4, "Rent", { bank: 500, mine: 450 })],
		});

		expect(screen.getByText("$50.00 more than yours")).toBeInTheDocument();
	});

	it("names the row in each answer group, as many rows share a description", () => {
		renderPiles({ reviews: [COFFEE] });

		expect(
			screen.getByRole("group", {
				name: `Answer for Coffee Club Brisbane, ${formatDate(COFFEE.mine.date)}, $5.00`,
			}),
		).toBeInTheDocument();
	});

	it("says what each answer does", () => {
		renderPiles({ reviews: [COFFEE] });

		expect(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		).toHaveAccessibleDescription("Keep mine drops the bank's copy.");
		expect(
			within(answerFor("Coffee")).getByRole("radio", { name: "Use bank's" }),
		).toHaveAccessibleDescription(
			"Use bank's gives yours its date and amount, and keeps your description, category, expense and receipt.",
		);
	});

	it("applies the picked answers together", async () => {
		const { onApply, user } = renderPiles();

		await user.click(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		);
		await user.click(
			within(answerFor("Vercel")).getByRole("radio", { name: "Both are real" }),
		);
		expect(screen.getByText(/of 3 answered/)).toHaveTextContent(
			"2 of 3 answered",
		);
		await user.click(screen.getByRole("button", { name: "Apply 2 answers" }));

		expect(onApply).toHaveBeenCalledWith([
			{ id: 1, answer: Answer.KeepMine },
			{ id: 3, answer: Answer.BothReal },
		]);
	});

	it("fills a pile's suggestion only into its rows without an answer", async () => {
		const { onApply, user } = renderPiles();

		await user.click(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		);
		await user.click(
			screen.getByRole("button", { name: "Use bank's for the last one" }),
		);
		await user.click(
			screen.getByRole("button", { name: "Both are real for this one" }),
		);

		expect(
			screen.getAllByRole("button", { name: "All answered" }),
		).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "Apply 3 answers" }));
		expect(onApply).toHaveBeenCalledWith([
			{ id: 1, answer: Answer.KeepMine },
			{ id: 2, answer: Answer.UseBank },
			{ id: 3, answer: Answer.BothReal },
		]);
	});

	it("clears an answer on a second click, and all of them with Clear", async () => {
		const { user } = renderPiles();
		const keep = within(answerFor("Coffee")).getByRole("radio", {
			name: "Keep mine",
		});

		await user.click(keep);
		await user.click(keep);
		expect(keep).not.toBeChecked();

		await user.click(
			screen.getByRole("button", { name: "Use bank's for all 2" }),
		);
		await user.click(screen.getByRole("button", { name: "Clear" }));
		expect(screen.getByText(/of 3 answered/)).toHaveTextContent(
			"0 of 3 answered",
		);
		expect(
			screen.getByRole("button", { name: "Apply 0 answers" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("clears a picked answer from the keyboard with Delete", async () => {
		const { user } = renderPiles({ reviews: [COFFEE] });
		const keep = within(answerFor("Coffee")).getByRole("radio", {
			name: "Keep mine",
		});

		await user.click(keep);
		await user.keyboard("{Delete}");

		expect(keep).not.toBeChecked();
		expect(keep).toHaveFocus();
	});

	it("keeps a picked answer on Space", async () => {
		const { user } = renderPiles({ reviews: [COFFEE] });
		const keep = within(answerFor("Coffee")).getByRole("radio", {
			name: "Keep mine",
		});

		await user.click(keep);
		await user.keyboard(" ");

		expect(keep).toBeChecked();
	});

	it("starts the applied rows blank once saved", async () => {
		const { user } = renderPiles();
		const keep = within(answerFor("Coffee")).getByRole("radio", {
			name: "Keep mine",
		});

		await user.click(keep);
		await user.click(screen.getByRole("button", { name: "Apply 1 answer" }));

		// A taken row stays to review, so its failed pick must not linger.
		expect(keep).not.toBeChecked();
	});

	it("keeps the picks when the apply failed, for another try", async () => {
		const { user } = renderPiles({ saved: false });
		const keep = within(answerFor("Coffee")).getByRole("radio", {
			name: "Keep mine",
		});

		await user.click(keep);
		await user.click(screen.getByRole("button", { name: "Apply 1 answer" }));

		expect(keep).toBeChecked();
	});

	it("holds every answer while the apply sends", () => {
		renderPiles({ sending: true });

		for (const radio of screen.getAllByRole("radio")) {
			expect(radio).toBeDisabled();
		}

		expect(
			screen.getByRole("button", { name: "Use bank's for all 2" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("holds Apply at the running count while an Apply runs", async () => {
		const { user } = renderPiles({ progress: { total: 200, pending: 80 } });

		await user.click(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		);

		expect(
			screen.getByRole("button", { name: "Applying 120 of 200…" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("keeps the answers open while an Apply runs", () => {
		renderPiles({ progress: { total: 200, pending: 80 } });

		for (const radio of screen.getAllByRole("radio")) {
			expect(radio).toBeEnabled();
		}

		expect(
			screen.getByRole("button", { name: "Use bank's for all 2" }),
		).not.toHaveAttribute("aria-disabled", "true");
	});

	it("starts a row on its saved answer and counts it", async () => {
		const { onApply, user } = renderPiles({
			reviews: [{ ...COFFEE, answer: Answer.UseBank }, GROCERIES, VERCEL],
		});

		expect(
			within(answerFor("Coffee")).getByRole("radio", { name: "Use bank's" }),
		).toBeChecked();
		expect(screen.getByText(/of 3 answered/)).toHaveTextContent(
			"1 of 3 answered",
		);
		expect(
			screen.getByRole("button", { name: "Use bank's for the last one" }),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Apply 1 answer" }));
		expect(onApply).toHaveBeenCalledWith([{ id: 1, answer: Answer.UseBank }]);
	});

	it("blanks a saved answer with Clear", async () => {
		const { user } = renderPiles({
			reviews: [{ ...COFFEE, answer: Answer.UseBank }],
		});

		await user.click(screen.getByRole("button", { name: "Clear" }));

		expect(
			within(answerFor("Coffee")).getByRole("radio", { name: "Use bank's" }),
		).not.toBeChecked();
		expect(screen.getByText(/of 1 answered/)).toHaveTextContent(
			"0 of 1 answered",
		);
	});

	it("marks a row its Apply didn't apply", () => {
		renderPiles({
			reviews: [
				{ ...COFFEE, answer: Answer.KeepMine, notApplied: true },
				GROCERIES,
			],
		});

		expect(screen.getAllByText("Didn't apply")).toHaveLength(1);
	});

	it("folds a pile away", async () => {
		const { user } = renderPiles();
		const trigger = screen.getByRole("button", {
			name: /^Similar description/,
		});

		await user.click(trigger);

		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(
			screen.queryByRole("group", { name: /^Answer for Coffee,/ }),
		).toBeNull();
	});
});
