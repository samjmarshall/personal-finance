"use client";

import { useState } from "react";

import { Modal } from "~/app/_components/ui/modal";
import { Field, Select } from "~/app/_components/ui/primitives";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { EXPENSE_CATEGORIES } from "~/lib/constants";
import { api, type RouterOutputs } from "~/trpc/react";

type Expense = RouterOutputs["expense"]["list"][number];

const FORTNIGHTS_PER_MONTH = 26 / 12;

export function ExpenseForm({
	open,
	onClose,
	expense,
}: {
	open: boolean;
	onClose: () => void;
	expense: Expense | null;
}) {
	const utils = api.useUtils();
	const { data: managedCategories } = api.category.list.useQuery();
	const categoryOptions = managedCategories?.length
		? managedCategories.map((c) => c.name)
		: [...EXPENSE_CATEGORIES];
	const [name, setName] = useState(expense?.name ?? "");
	const [category, setCategory] = useState(
		expense?.category ?? EXPENSE_CATEGORIES[1],
	);
	const [basis, setBasis] = useState<"fortnight" | "month" | "year">("month");
	const [amount, setAmount] = useState(() => {
		if (!expense) return "";
		const value = expense.month || expense.fortnight || expense.year;
		return value ? String(Number(value.toFixed(2))) : "";
	});
	const [error, setError] = useState<string | null>(null);

	const onSuccess = async () => {
		await utils.expense.list.invalidate();
		onClose();
	};

	const create = api.expense.create.useMutation({ onSuccess });
	const update = api.expense.update.useMutation({ onSuccess });
	const isSaving = create.isPending || update.isPending;

	function deriveAmounts(value: number, from: "fortnight" | "month" | "year") {
		let month: number;
		if (from === "fortnight") month = value * FORTNIGHTS_PER_MONTH;
		else if (from === "year") month = value / 12;
		else month = value;
		return {
			fortnight: Number((month / FORTNIGHTS_PER_MONTH).toFixed(2)),
			month: Number(month.toFixed(2)),
			year: Number((month * 12).toFixed(2)),
		};
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const value = Number.parseFloat(amount);
		if (!name.trim()) return setError("Please enter a name.");
		if (Number.isNaN(value) || value < 0)
			return setError("Please enter a valid amount.");

		const amounts = deriveAmounts(value, basis);
		const payload = { name: name.trim(), category, ...amounts };

		if (expense) update.mutate({ id: expense.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Modal
			description="Enter the amount on any cadence — we'll work out the rest."
			onClose={onClose}
			open={open}
			title={expense ? "Edit expense" : "Add expense"}
		>
			<form className="flex flex-col gap-4" onSubmit={onSubmit}>
				<Field htmlFor="exp-name" label="Name">
					<Input
						autoFocus
						id="exp-name"
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Netflix"
						value={name}
					/>
				</Field>
				<Field htmlFor="exp-cat" label="Category">
					<Select
						id="exp-cat"
						onChange={(e) => setCategory(e.target.value)}
						value={category}
					>
						{(categoryOptions.includes(category)
							? categoryOptions
							: [category, ...categoryOptions]
						).map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</Select>
				</Field>
				<div className="grid grid-cols-2 gap-3">
					<Field htmlFor="exp-amt" label="Amount">
						<Input
							id="exp-amt"
							inputMode="decimal"
							min="0"
							onChange={(e) => setAmount(e.target.value)}
							placeholder="0.00"
							step="0.01"
							type="number"
							value={amount}
						/>
					</Field>
					<Field htmlFor="exp-basis" label="Per">
						<Select
							id="exp-basis"
							onChange={(e) =>
								setBasis(e.target.value as "fortnight" | "month" | "year")
							}
							value={basis}
						>
							<option value="fortnight">Fortnight</option>
							<option value="month">Month</option>
							<option value="year">Year</option>
						</Select>
					</Field>
				</div>

				{error && (
					<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend">
						{error}
					</p>
				)}

				<div className="mt-1 flex justify-end gap-2">
					<Button onClick={onClose} type="button" variant="outline">
						Cancel
					</Button>
					<Button disabled={isSaving} type="submit">
						{isSaving ? "Saving…" : expense ? "Save changes" : "Add expense"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
