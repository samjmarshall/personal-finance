import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComboboxField } from "./combobox-field";

const items = [
	{ value: 1, label: "Apple" },
	{ value: 2, label: "Banana" },
];

// Feeds each pick back like the real form, so the X shows up.
function Field({
	initial,
	options,
	onValueChange,
}: {
	initial: number | null;
	options: typeof items;
	onValueChange: (value: number | null) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<>
			<label htmlFor="fruit">Fruit</label>
			<ComboboxField
				emptyText="No fruit found."
				id="fruit"
				items={options}
				label="Fruit"
				onValueChange={(next) => {
					setValue(next);
					onValueChange(next);
				}}
				value={value}
			/>
			<button type="button">Next</button>
		</>
	);
}

function renderField(value: number | null = null, options = items) {
	const onValueChange = vi.fn();
	render(
		<Field initial={value} onValueChange={onValueChange} options={options} />,
	);
	return {
		input: screen.getByRole("combobox", { name: "Fruit" }),
		onValueChange,
	};
}

describe("ComboboxField", () => {
	it("shows the picked option's label", () => {
		const { input } = renderField(2);

		expect(input).toHaveValue("Banana");
	});

	it("typing filters the list", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		await user.type(input, "ban");

		expect(
			await screen.findByRole("option", { name: "Banana" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("option", { name: "Apple" })).toBeNull();
	});

	it("picking an option emits its value", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField();
		await user.type(input, "app");
		await user.click(await screen.findByRole("option", { name: "Apple" }));

		expect(onValueChange).toHaveBeenCalledWith(1);
	});

	it("clear emits null", async () => {
		const user = userEvent.setup();
		const { onValueChange } = renderField(1);
		await user.click(screen.getByRole("button", { name: "Clear Fruit" }));

		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("a saved value missing from the list can still be cleared", async () => {
		const user = userEvent.setup();
		// Stale list can miss the saved row; the X must still unlink it.
		const { input, onValueChange } = renderField(99);
		await user.click(screen.getByRole("button", { name: "Clear Fruit" }));

		expect(input).toHaveValue("");
		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("keyboard can reach the X and clear", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(1);
		input.focus();
		await user.tab();

		expect(screen.getByRole("button", { name: "Clear Fruit" })).toHaveFocus();
		await user.keyboard("{Enter}");
		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("emptying the text mid-search keeps the pick and restores its label on blur", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.click(input);
		await user.clear(input);
		await user.tab();

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("emptying the text with the list shut keeps the pick and restores its label on blur", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		// Real keyboard path: Backspace on a shut list, not a programmatic clear.
		input.focus();
		(input as HTMLInputElement).select();
		await user.keyboard("{Backspace}");
		await user.tab();

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("Enter picks the highlighted match", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField();
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.keyboard("{Enter}");

		expect(onValueChange).toHaveBeenCalledWith(2);
	});

	it("Tab picks the highlighted match and moves on", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField();
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.tab();

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(2);
		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
	});

	it("Shift+Tab picks the highlighted match too", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField();
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.tab({ shift: true });

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(2);
		expect(input).not.toHaveFocus();
	});

	it("Tab pick on a live field moves past the X that appears", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.tab();

		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("Tab pick on a filled live field moves past its X", async () => {
		const user = userEvent.setup();
		const { input } = renderField(1);
		await user.clear(input);
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.tab();

		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
		await waitFor(() => expect(input).toHaveValue("Banana"));
		expect(screen.getByRole("button", { name: "Clear Fruit" })).toBeVisible();
	});

	it("Tab takes a typed full name over a longer match above it", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(null, [
			{ value: 1, label: "Bank fees" },
			{ value: 2, label: "Fees" },
		]);
		await user.type(input, "fees");
		await screen.findByRole("option", { name: "Bank fees" });
		await user.tab();

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("a typed full name lists first, lit up, and Enter takes it", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(null, [
			{ value: 1, label: "Bank fees" },
			{ value: 2, label: "Fees" },
		]);
		await user.type(input, "fees");
		const [first] = await screen.findAllByRole("option");

		expect(first).toHaveAccessibleName("Fees");
		expect(first).toHaveAttribute("data-highlighted");
		await user.keyboard("{Enter}");
		expect(onValueChange).toHaveBeenCalledWith(2);
	});

	it("Tab takes a hovered row over a typed full name", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(null, [
			{ value: 1, label: "Bank fees" },
			{ value: 2, label: "Fees" },
		]);
		await user.type(input, "fees");
		await user.hover(await screen.findByRole("option", { name: "Bank fees" }));
		await user.tab();

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("Tab takes an arrowed-to row over a typed full name", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(null, [
			{ value: 1, label: "Fees" },
			{ value: 2, label: "Bank fees" },
		]);
		await user.type(input, "fees");
		await screen.findByRole("option", { name: "Bank fees" });
		await user.keyboard("{ArrowDown}");
		await user.tab();

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("Tab takes the arrowed-to row of two with the same name", async () => {
		const user = userEvent.setup();
		// Expense names need not be unique.
		const { input, onValueChange } = renderField(null, [
			{ value: 1, label: "Rego" },
			{ value: 2, label: "Rego" },
		]);
		await user.type(input, "rego");
		await screen.findAllByRole("option", { name: "Rego" });
		await user.keyboard("{ArrowDown}");
		await user.tab();

		expect(onValueChange).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("Tab on a reopened filled field keeps the pick", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.click(input);
		await screen.findByRole("option", { name: "Apple" });
		await user.tab();

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("Tab after arrowing on a reopened filled field keeps the pick", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.click(input);
		await screen.findByRole("option", { name: "Apple" });
		await user.keyboard("{ArrowUp}");
		await user.tab();

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("Tab with no match keeps the pick", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.clear(input);
		await user.type(input, "kiwi");
		await screen.findByText("No fruit found.");
		await user.tab();

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("click-away mid-search keeps the pick", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.clear(input);
		await user.type(input, "app");
		await screen.findByRole("option", { name: "Apple" });
		await user.click(document.body);

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("a Tab that never left the field picks nothing later", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.clear(input);
		await user.type(input, "app");
		await screen.findByRole("option", { name: "Apple" });
		// A blocked Tab: the key fires but focus stays put.
		fireEvent.keyDown(input, { key: "Tab" });
		await user.clear(input);
		await user.type(input, "kiwi");
		await screen.findByText("No fruit found.");
		await user.click(document.body);

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("Ctrl+Tab then leaving the window picks nothing", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		await user.clear(input);
		await user.type(input, "app");
		await screen.findByRole("option", { name: "Apple" });
		// Switching browser tabs: the key reaches the page, then focus leaves.
		fireEvent.keyDown(input, { key: "Tab", ctrlKey: true });
		await user.click(document.body);

		expect(onValueChange).not.toHaveBeenCalled();
		await waitFor(() => expect(input).toHaveValue("Banana"));
	});

	it("a click pick after a blocked Tab wins", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField();
		await user.type(input, "a");
		await screen.findByRole("option", { name: "Banana" });
		fireEvent.keyDown(input, { key: "Tab" });
		await user.click(screen.getByRole("option", { name: "Banana" }));
		await user.click(document.body);

		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith(2);
	});

	it("Enter with no match does not submit the form", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
		render(
			<form onSubmit={onSubmit}>
				<label htmlFor="fruit">Fruit</label>
				<ComboboxField
					emptyText="No fruit found."
					id="fruit"
					items={items}
					label="Fruit"
					onValueChange={vi.fn()}
					value={null}
				/>
				<button type="submit">Save</button>
			</form>,
		);
		await user.type(screen.getByRole("combobox", { name: "Fruit" }), "kiwi");
		await screen.findByText("No fruit found.");
		await user.keyboard("{Enter}");

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("Escape on a shut list keeps the pick and reaches the dialog", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(2);
		// The dialog listens for Escape on the document.
		const onDocumentKeyDown = vi.fn();
		document.addEventListener("keydown", onDocumentKeyDown);
		input.focus();
		await user.keyboard("{Escape}");
		document.removeEventListener("keydown", onDocumentKeyDown);

		expect(onValueChange).not.toHaveBeenCalled();
		expect(input).toHaveValue("Banana");
		expect(onDocumentKeyDown).toHaveBeenCalled();
	});

	it("a parent re-render keeps the half-typed search", async () => {
		const user = userEvent.setup();
		const props = {
			emptyText: "No fruit found.",
			id: "fruit",
			label: "Fruit",
			onValueChange: vi.fn(),
			value: 2,
		};
		const { rerender } = render(
			<>
				<label htmlFor="fruit">Fruit</label>
				<ComboboxField {...props} items={items} />
			</>,
		);
		const input = screen.getByRole("combobox", { name: "Fruit" });
		await user.clear(input);
		await user.type(input, "ap");
		// A refetch hands down equal options in a new array.
		rerender(
			<>
				<label htmlFor="fruit">Fruit</label>
				<ComboboxField {...props} items={items.map((i) => ({ ...i }))} />
			</>,
		);

		expect(input).toHaveValue("ap");
	});

	it("Tab skips the named open-list button", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		input.focus();
		await user.tab();

		expect(
			screen.getByRole("button", { name: "Show Fruit options" }),
		).toBeVisible();
		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
	});

	it("names the X, open-list button and list after its field", async () => {
		const user = userEvent.setup();
		const { input } = renderField(1);

		expect(screen.getByRole("button", { name: "Clear Fruit" })).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Show Fruit options" }),
		).toBeInTheDocument();
		await user.click(input);
		expect(await screen.findByRole("listbox", { name: "Fruit" })).toBeVisible();
	});

	it("no match shows the empty text", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		await user.type(input, "kiwi");

		expect(await screen.findByText("No fruit found.")).toBeInTheDocument();
	});
});
