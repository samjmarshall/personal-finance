import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlusIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "~/components/ui/button";

// The spinner is decorative (aria-hidden) with no role, so its slot is the hook.
const spinnerIn = (el: HTMLElement) =>
	el.querySelector('[data-slot="spinner"]');

describe("Button loading", () => {
	it("shows a spinner beside the kept label and marks the button busy", () => {
		render(<Button loading>Save</Button>);

		const button = screen.getByRole("button", { name: "Save" });
		expect(button).toHaveAttribute("aria-busy", "true");
		expect(spinnerIn(button)).toBeInTheDocument();
	});

	it("keeps an icon button's screen-reader label while it shows the spinner", () => {
		render(
			<Button loading size="icon">
				<PlusIcon />
				<span className="sr-only">Add</span>
			</Button>,
		);

		const button = screen.getByRole("button", { name: "Add" });
		expect(spinnerIn(button)).toBeInTheDocument();
	});

	it("ignores clicks", async () => {
		const user = userEvent.setup();
		const onClick = vi.fn();
		render(
			<Button loading onClick={onClick}>
				Save
			</Button>,
		);

		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(onClick).not.toHaveBeenCalled();
	});

	it("stays focusable so keyboard focus isn't dropped", async () => {
		const user = userEvent.setup();
		render(<Button loading>Save</Button>);

		await user.tab();

		expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
	});

	it("shows no spinner when idle", () => {
		render(<Button>Save</Button>);

		const button = screen.getByRole("button", { name: "Save" });
		expect(button).not.toHaveAttribute("aria-busy");
		expect(spinnerIn(button)).not.toBeInTheDocument();
	});
});
