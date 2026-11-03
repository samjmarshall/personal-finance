import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComboboxField } from "./combobox-field";

const items = [
	{ value: 1, label: "Apple" },
	{ value: 2, label: "Banana" },
];

function renderField(value: number | null = null, options = items) {
	const onValueChange = vi.fn();
	render(
		<>
			<label htmlFor="fruit">Fruit</label>
			<ComboboxField
				emptyText="No fruit found."
				id="fruit"
				items={options}
				onValueChange={onValueChange}
				value={value}
			/>
			<button type="button">Next</button>
		</>,
	);
	return {
		input: screen.getByRole("combobox", { name: "Fruit" }),
		onValueChange,
	};
}

// Feeds each pick back like the real form, so the X shows up.
function LiveField() {
	const [value, setValue] = useState<number | null>(null);
	return (
		<>
			<label htmlFor="fruit">Fruit</label>
			<ComboboxField
				emptyText="No fruit found."
				id="fruit"
				items={items}
				onValueChange={setValue}
				value={value}
			/>
			<button type="button">Next</button>
		</>
	);
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
		await user.click(screen.getByRole("button", { name: "Clear" }));

		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("keyboard can reach the X and clear", async () => {
		const user = userEvent.setup();
		const { input, onValueChange } = renderField(1);
		input.focus();
		await user.tab();

		expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
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

		expect(onValueChange).toHaveBeenCalledWith(2);
		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
	});

	it("Tab pick on a live field moves past the X that appears", async () => {
		const user = userEvent.setup();
		render(<LiveField />);
		const input = screen.getByRole("combobox", { name: "Fruit" });
		await user.type(input, "ban");
		await screen.findByRole("option", { name: "Banana" });
		await user.tab();

		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
		await waitFor(() => expect(input).toHaveValue("Banana"));
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

		expect(onValueChange).toHaveBeenCalledWith(2);
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

		expect(onValueChange).toHaveBeenCalledWith(2);
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

		expect(onValueChange).toHaveBeenCalledWith(2);
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

		expect(screen.getByRole("button", { name: "Show options" })).toBeVisible();
		expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
	});

	it("names the X after its field", () => {
		render(
			<ComboboxField
				clearLabel="Clear Fruit"
				emptyText="No fruit found."
				items={items}
				onValueChange={vi.fn()}
				value={1}
			/>,
		);

		expect(screen.getByRole("button", { name: "Clear Fruit" })).toBeVisible();
	});

	it("no match shows the empty text", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		await user.type(input, "kiwi");

		expect(await screen.findByText("No fruit found.")).toBeInTheDocument();
	});
});
