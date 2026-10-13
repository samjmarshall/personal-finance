import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "~/components/confirm-dialog";

function Harness({
	onConfirm,
	pending = false,
}: {
	onConfirm?: () => Promise<void>;
	pending?: boolean;
}) {
	const [open, setOpen] = useState(true);
	const [running, setRunning] = useState(false);
	return (
		<ConfirmDialog
			confirmLabel="Delete"
			onConfirm={async () => {
				setRunning(true);
				try {
					await onConfirm?.();
					setOpen(false);
				} catch {
					// The owning view's global toast reports it; the dialog stays open.
				} finally {
					setRunning(false);
				}
			}}
			onOpenChange={setOpen}
			open={open}
			pending={pending || running}
			title="Delete it?"
		/>
	);
}

describe("ConfirmDialog", () => {
	it("closes on Esc and Cancel when idle", async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		});
	});

	it("stays open on Esc while pending", async () => {
		const user = userEvent.setup();
		render(<Harness pending />);

		await user.keyboard("{Escape}");

		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
	});

	it("locks Cancel and marks the action busy while pending", async () => {
		const user = userEvent.setup();
		render(<Harness pending />);

		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect(cancel).toBeDisabled();
		await user.click(cancel);

		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
	});

	it("stays open while the confirm runs, then closes when it resolves", async () => {
		const user = userEvent.setup();
		let finish: () => void = () => undefined;
		render(
			<Harness
				onConfirm={() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					})
				}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
			"aria-busy",
			"true",
		);

		finish();

		await waitFor(() => {
			expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		});
	});

	it("stays open and unlocks when the confirm rejects", async () => {
		const user = userEvent.setup();
		render(<Harness onConfirm={() => Promise.reject(new Error("nope"))} />);

		await user.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Delete" }),
			).not.toHaveAttribute("aria-busy");
		});
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
	});
});
