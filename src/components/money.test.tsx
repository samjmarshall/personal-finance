import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Money } from "~/components/money";
import { formatCurrency } from "~/lib/utils";

describe("Money", () => {
	it("renders the formatted amount", () => {
		render(<Money value={12.5} />);

		expect(screen.getByText(formatCurrency(12.5))).toBeInTheDocument();
	});

	it("ledger tone: a positive amount is spend", () => {
		render(<Money tone="ledger" value={12.5} />);

		expect(screen.getByText(formatCurrency(12.5))).toHaveClass("text-spend");
	});

	it("ledger tone: a negative amount is a refund", () => {
		render(<Money tone="ledger" value={-12.5} />);

		expect(screen.getByText(formatCurrency(12.5))).toHaveClass("text-positive");
	});

	it("signed prefixes a negative amount with +", () => {
		render(<Money signed value={-12.5} />);

		expect(screen.getByText(`+${formatCurrency(12.5)}`)).toBeInTheDocument();
	});
});
