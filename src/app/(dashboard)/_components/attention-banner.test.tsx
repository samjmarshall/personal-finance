import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AttentionBanner } from "./attention-banner";

describe("AttentionBanner", () => {
	it("shows its content as a status", () => {
		render(<AttentionBanner tone="warn">Bank sync is behind.</AttentionBanner>);
		expect(screen.getByRole("status")).toHaveTextContent(
			"Bank sync is behind.",
		);
	});

	it("hides when dismissed", async () => {
		const user = userEvent.setup();
		render(<AttentionBanner tone="alert">Reauthorize.</AttentionBanner>);
		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByRole("status")).toBeNull();
	});
});
