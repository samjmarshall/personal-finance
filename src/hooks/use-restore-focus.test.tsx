import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useRestoreFocus } from "~/hooks/use-restore-focus";

function Form({ settle }: { settle: () => Promise<void> }) {
	const [locked, setLocked] = useState(false);
	const rememberFocus = useRestoreFocus(locked);
	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				rememberFocus();
				setLocked(true);
				// jsdom keeps focus on a disabled field; a browser drops it to body.
				if (document.activeElement instanceof HTMLElement) {
					document.activeElement.blur();
				}
				await settle().catch(() => undefined);
				setLocked(false);
			}}
		>
			<fieldset disabled={locked}>
				<input aria-label="Name" />
			</fieldset>
			<button type="button">Elsewhere</button>
		</form>
	);
}

describe("useRestoreFocus", () => {
	it("puts focus back on the field that had it once the form unlocks", async () => {
		const user = userEvent.setup();
		render(<Form settle={() => Promise.reject(new Error("nope"))} />);
		const field = screen.getByRole("textbox", { name: "Name" });

		await user.click(field);
		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(field).toHaveFocus();
		});
	});

	it("leaves focus alone when the Member moved it while locked", async () => {
		const user = userEvent.setup();
		let finish: () => void = () => undefined;
		render(
			<Form
				settle={() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					})
				}
			/>,
		);
		await user.click(screen.getByRole("textbox", { name: "Name" }));
		await user.keyboard("{Enter}");
		const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
		elsewhere.focus();

		finish();

		await waitFor(() => {
			expect(elsewhere).toHaveFocus();
		});
	});
});
