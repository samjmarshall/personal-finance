import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "~/components/select-field";

const items = [
	{ value: "a", label: "Apple" },
	{ value: "b", label: "Banana" },
];

function renderField({ readOnly = false }: { readOnly?: boolean } = {}) {
	render(
		<SelectField
			aria-label="Fruit"
			items={items}
			onValueChange={vi.fn()}
			readOnly={readOnly}
			value="a"
		/>,
	);
	return screen.getByRole("combobox", { name: "Fruit" });
}

// The popup mounts a tick after the press, so a bare query passes too early.
async function expectListStaysClosed() {
	await expect(
		screen.findByRole("listbox", {}, { timeout: 300 }),
	).rejects.toThrow();
}

describe("SelectField", () => {
	it("opens its list on click", async () => {
		const user = userEvent.setup();
		await user.click(renderField());

		expect(await screen.findByRole("listbox")).toBeInTheDocument();
	});

	it("read-only: click does not open the list", async () => {
		const user = userEvent.setup();
		const trigger = renderField({ readOnly: true });
		await user.click(trigger);

		await expectListStaysClosed();
	});

	it("read-only: keyboard does not open the list", async () => {
		const user = userEvent.setup();
		const trigger = renderField({ readOnly: true });
		trigger.focus();
		await user.keyboard("{ArrowDown}");

		await expectListStaysClosed();
	});
});
