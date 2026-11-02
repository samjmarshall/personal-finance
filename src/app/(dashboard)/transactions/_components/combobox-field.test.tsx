import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ComboboxField } from "./combobox-field";

const items = [
	{ value: 1, label: "Apple" },
	{ value: 2, label: "Banana" },
];

function renderField(value: number | null = null) {
	const onValueChange = vi.fn();
	render(
		<>
			<label htmlFor="fruit">Fruit</label>
			<ComboboxField
				emptyText="No fruit found."
				id="fruit"
				items={items}
				onValueChange={onValueChange}
				value={value}
			/>
		</>,
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
		await user.click(screen.getByRole("button", { name: "Clear" }));

		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("no match shows the empty text", async () => {
		const user = userEvent.setup();
		const { input } = renderField();
		await user.type(input, "kiwi");

		expect(await screen.findByText("No fruit found.")).toBeInTheDocument();
	});
});
