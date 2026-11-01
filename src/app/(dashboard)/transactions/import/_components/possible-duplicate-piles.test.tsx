import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
	PossibleDuplicateReview,
	ResolveDuplicateInput,
} from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import { PossibleDuplicatePiles } from "./possible-duplicate-piles";

// Bank days are UTC midnight; yours are Sydney midnight (13:00 UTC the day before, AEDT).
function review(
	id: number,
	description: string,
	{ bank, mine, days = 0 }: { bank: number; mine: number; days?: number },
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
	};
}

const COFFEE = review(1, "Coffee", { bank: 5, mine: 5, days: 2 });
const GROCERIES = review(2, "Groceries", { bank: 80, mine: 80, days: 1 });
const VERCEL = review(3, "Vercel", { bank: 30, mine: 30 });
const REVIEWS = [COFFEE, GROCERIES, VERCEL];

function renderPiles({
	reviews = REVIEWS,
	applying = false,
	saved = true,
}: {
	reviews?: PossibleDuplicateReview[];
	applying?: boolean;
	saved?: boolean;
} = {}) {
	const onApply = vi.fn(async (_: ResolveDuplicateInput[]) => saved);
	render(
		<PossibleDuplicatePiles
			applying={applying}
			onApply={onApply}
			reviews={reviews}
		/>,
	);
	return { onApply, user: userEvent.setup() };
}

const answerFor = (description: string) =>
	screen.getByRole("group", {
		name: new RegExp(`^Answer for ${description},`),
	});

describe("PossibleDuplicatePiles", () => {
	it("shows every row in one same-amount pile", () => {
		renderPiles();

		const piles = screen.getAllByRole("heading", { level: 3 });
		expect(piles.map((pile) => pile.textContent)).toEqual([
			"Same amount · , 3",
		]);
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
				name: `Answer for Coffee, ${formatDate(COFFEE.mine.date)}, $5.00`,
			}),
		).toBeInTheDocument();
	});

	it("says what each answer does", () => {
		renderPiles({ reviews: [COFFEE] });

		expect(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		).toHaveAccessibleDescription("Keep mine drops the bank's copy.");
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
			{ id: 1, choice: "keep_mine" },
			{ id: 3, choice: "both_real" },
		]);
	});

	it("fills a pile's suggestion only into its rows without an answer", async () => {
		const { onApply, user } = renderPiles();

		await user.click(
			within(answerFor("Coffee")).getByRole("radio", { name: "Keep mine" }),
		);
		await user.click(
			screen.getByRole("button", { name: "Use bank's for the other 2" }),
		);

		expect(
			screen.getByRole("button", { name: "All answered" }),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Apply 3 answers" }));
		expect(onApply).toHaveBeenCalledWith([
			{ id: 1, choice: "keep_mine" },
			{ id: 2, choice: "use_bank" },
			{ id: 3, choice: "use_bank" },
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
			screen.getByRole("button", { name: "Use bank's for all 3" }),
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

	it("holds every answer while an apply saves", () => {
		renderPiles({ applying: true });

		for (const radio of screen.getAllByRole("radio"))
			expect(radio).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Use bank's for all 3" }),
		).toHaveAttribute("aria-disabled", "true");
	});

	it("folds a pile away", async () => {
		const { user } = renderPiles();
		const trigger = screen.getByRole("button", { name: /^Same amount/ });

		await user.click(trigger);

		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(
			screen.queryByRole("group", { name: /^Answer for Coffee,/ }),
		).toBeNull();
	});
});
