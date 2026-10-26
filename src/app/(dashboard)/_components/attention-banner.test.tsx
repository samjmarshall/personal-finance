import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionBanner } from "./attention-banner";

describe("AttentionBanner", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

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

	it("hands focus to the control before it when dismissed from the keyboard", async () => {
		const user = userEvent.setup();
		render(
			<>
				<button type="button">Chart period</button>
				<AttentionBanner tone="alert">
					Syncing has stopped. <a href="https://example.com">Open RedBark</a>
				</AttentionBanner>
			</>,
		);
		await user.tab();
		await user.tab();
		await user.tab();
		expect(screen.getByRole("button", { name: "Dismiss" })).toHaveFocus();

		await user.keyboard("{Enter}");
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByRole("button", { name: "Chart period" })).toHaveFocus();
	});

	it("keeps focused fields clear of it, until dismissed", async () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(private readonly report: ResizeObserverCallback) {}
				observe() {
					this.report(
						[{ borderBoxSize: [{ blockSize: 120 }] } as never],
						this as never,
					);
				}
				disconnect() {}
			},
		);
		const user = userEvent.setup();
		render(<AttentionBanner tone="warn">Bank sync is behind.</AttentionBanner>);
		const page = document.documentElement;
		// 120 px tall, plus its 16 px float above the screen's edge and 8 px of air.
		expect(page.style.scrollPaddingBottom).toBe("144px");

		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(page.style.scrollPaddingBottom).toBe("");
	});
});
