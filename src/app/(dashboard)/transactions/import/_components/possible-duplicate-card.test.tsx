import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PossibleDuplicateReview } from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import {
	type DuplicateChoice,
	PossibleDuplicateCard,
} from "./possible-duplicate-card";

const REVIEW: PossibleDuplicateReview = {
	id: 4,
	bank: {
		date: new Date("2026-02-04T13:00:00.000Z"),
		amount: 51.2,
		description: "WOOLWORTHS 1234 SYDNEY",
		accountName: "Everyday",
	},
	mine: {
		id: 9,
		date: new Date("2026-02-01T13:00:00.000Z"),
		amount: 50,
		description: "Groceries",
		accountName: null,
		provenance: Provenance.Manual,
	},
};

function renderCard(pending: DuplicateChoice | null = null) {
	const onResolve = vi.fn();
	render(
		<PossibleDuplicateCard
			onResolve={onResolve}
			pending={pending}
			review={REVIEW}
		/>,
	);
	return { onResolve };
}

describe("PossibleDuplicateCard", () => {
	it("shows the member's row beside the bank's, with the gaps called out", () => {
		renderCard();

		const mine = screen.getByRole("group", { name: "In Ledger" });
		const bank = screen.getByRole("group", { name: "From the bank" });
		expect(within(mine).getByText("Groceries")).toBeInTheDocument();
		expect(within(mine).getByText("No account")).toBeInTheDocument();
		expect(
			within(bank).getByText("WOOLWORTHS 1234 SYDNEY"),
		).toBeInTheDocument();
		expect(within(bank).getByText("Everyday")).toBeInTheDocument();
		expect(
			within(bank).getByText("3 days later than yours"),
		).toBeInTheDocument();
		expect(within(bank).getByText("$1.20 more than yours")).toBeInTheDocument();
	});

	it.each([
		["Keep mine", "keep_mine"],
		["Use bank's", "use_bank"],
		["Both are real", "both_real"],
	])("%s answers with %s", async (name, choice) => {
		const user = userEvent.setup();
		const { onResolve } = renderCard();

		await user.click(screen.getByRole("button", { name }));

		expect(onResolve).toHaveBeenCalledExactlyOnceWith(choice);
	});

	it("tells each answer what it does and which row it's for", () => {
		renderCard();

		expect(
			screen.getByRole("button", { name: "Keep mine" }),
		).toHaveAccessibleDescription(
			`Keep mine drops the bank's copy. Possible duplicate of Groceries, ${formatDate(REVIEW.mine.date)}, $50.00`,
		);
	});

	it("holds every answer while one saves", async () => {
		const user = userEvent.setup();
		const { onResolve } = renderCard("use_bank");

		for (const name of ["Keep mine", "Use bank's", "Both are real"])
			await user.click(screen.getByRole("button", { name }));

		expect(onResolve).not.toHaveBeenCalled();
	});
});
