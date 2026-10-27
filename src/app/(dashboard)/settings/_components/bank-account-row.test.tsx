import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BankAccountRow, type BankAccountRowProps } from "./bank-account-row";

const ACCOUNT: BankAccountRowProps["account"] = {
	accountId: "acc_1",
	accountName: "Everyday Offset",
	accountNumber: "xxxx8273",
	balance: -8394.25,
	inBalance: true,
	nickname: null,
};

function renderRow(over: Partial<BankAccountRowProps["account"]> = {}) {
	const onInBalanceChange = vi.fn();
	const onRename = vi.fn();
	render(
		<ul>
			<BankAccountRow
				account={{ ...ACCOUNT, ...over }}
				onInBalanceChange={onInBalanceChange}
				onRename={onRename}
			/>
		</ul>,
	);
	return { onInBalanceChange, onRename, user: userEvent.setup() };
}

const toggle = (name = "Everyday Offset") =>
	screen.getByRole("switch", {
		name: `Count ${name} xxxx8273 in cash balance`,
	});
const pencil = (name = "Everyday Offset") =>
	screen.getByRole("button", { name: `Rename ${name} xxxx8273` });
const nameBox = (name = "Everyday Offset") =>
	screen.getByRole("textbox", { name: `New name for ${name} xxxx8273` });

describe("BankAccountRow", () => {
	it.each([
		[true, true],
		[false, false],
		[null, false],
	])("shows the switch on only when the flag is true (%s)", (inBalance, on) => {
		renderRow({ inBalance });

		if (on) expect(toggle()).toBeChecked();
		else expect(toggle()).not.toBeChecked();
	});

	it.each([
		[true, false],
		[false, true],
	])("flipping from %s calls onInBalanceChange(%s)", async (from, to) => {
		const { onInBalanceChange, user } = renderRow({ inBalance: from });

		await user.click(toggle());

		expect(onInBalanceChange).toHaveBeenCalledWith(to);
	});

	it("shows the name, masked number and signed balance", () => {
		renderRow();

		expect(screen.getByText("Everyday Offset")).toBeInTheDocument();
		expect(screen.getByText("xxxx8273")).toBeInTheDocument();
		expect(screen.getByText("-$8,394.25")).toBeInTheDocument();
	});

	it("says there is no balance yet before the first read", () => {
		renderRow({ balance: null });

		expect(screen.getByText("No balance yet")).toBeInTheDocument();
	});

	it("flags an undecided account, and leave it out sets false", async () => {
		const { onInBalanceChange, user } = renderRow({ inBalance: null });

		expect(
			screen.getByText(/New — switch on if it's cash/),
		).toBeInTheDocument();
		// Else a screen reader hears the same "off" as a decided row.
		expect(toggle()).toHaveAccessibleDescription(
			/New — switch on if it's cash/,
		);
		await user.click(screen.getByRole("button", { name: "leave it out" }));

		expect(onInBalanceChange).toHaveBeenCalledWith(false);
		// The button goes with the hint, so focus lands where the choice now shows.
		expect(toggle()).toHaveFocus();
	});

	it("shows no New hint once decided", () => {
		renderRow({ inBalance: false });

		expect(screen.queryByText(/New — switch on/)).not.toBeInTheDocument();
		expect(toggle()).not.toHaveAccessibleDescription();
	});

	it("shows the nickname, with the bank's name under it", () => {
		renderRow({ nickname: "Bills" });

		expect(toggle("Bills")).toBeInTheDocument();
		expect(screen.getByText("Everyday Offset")).toBeInTheDocument();
	});

	it("renames on Enter and puts focus back on the pencil", async () => {
		const { onRename, user } = renderRow();

		await user.click(pencil());
		expect(nameBox()).toHaveFocus();
		await user.type(nameBox(), "Bills{Enter}");

		expect(onRename).toHaveBeenCalledWith("Bills");
		expect(pencil()).toHaveFocus();
	});

	it("starts the box at the current nickname", async () => {
		const { user } = renderRow({ nickname: "Bills" });

		await user.click(pencil("Bills"));

		expect(nameBox("Bills")).toHaveValue("Bills");
	});

	it("cancels on Escape with no rename", async () => {
		const { onRename, user } = renderRow();

		await user.click(pencil());
		await user.type(nameBox(), "Bills{Escape}");

		expect(onRename).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(pencil()).toHaveFocus();
	});

	it("cancels on Escape from the form's buttons too", async () => {
		const { onRename, user } = renderRow();

		await user.click(pencil());
		await user.tab();
		expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
		await user.keyboard("{Escape}");

		expect(onRename).not.toHaveBeenCalled();
		expect(pencil()).toHaveFocus();
	});

	it("cancels with the Cancel button", async () => {
		const { onRename, user } = renderRow();

		await user.click(pencil());
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onRename).not.toHaveBeenCalled();
		expect(pencil()).toHaveFocus();
	});
});
