"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { EXPENSE_CATEGORIES } from "~/lib/constants";
import { api, type RouterOutputs } from "~/trpc/react";

type Expense = RouterOutputs["expense"]["list"][number];

const FORTNIGHTS_PER_MONTH = 26 / 12;

const BASIS_OPTIONS = [
	{ value: "fortnight", label: "Fortnight" },
	{ value: "month", label: "Month" },
	{ value: "year", label: "Year" },
] as const;

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
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
					<DialogDescription>
						Enter the amount on any cadence — we'll work out the rest.
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={onSubmit}>
					<Field>
						<FieldLabel htmlFor="exp-name">Name</FieldLabel>
						<Input
							id="exp-name"
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Netflix"
							value={name}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="exp-cat">Category</FieldLabel>
						<Select
							onValueChange={(v) => setCategory(v as string)}
							value={category}
						>
							<SelectTrigger className="w-full" id="exp-cat">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(categoryOptions.includes(category)
									? categoryOptions
									: [category, ...categoryOptions]
								).map((c) => (
									<SelectItem key={c} value={c}>
										{c}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field>
							<FieldLabel htmlFor="exp-amt">Amount</FieldLabel>
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
						<Field>
							<FieldLabel htmlFor="exp-basis">Per</FieldLabel>
							<Select
								items={BASIS_OPTIONS}
								onValueChange={(v) =>
									setBasis(v as "fortnight" | "month" | "year")
								}
								value={basis}
							>
								<SelectTrigger className="w-full" id="exp-basis">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{BASIS_OPTIONS.map((o) => (
										<SelectItem key={o.value} value={o.value}>
											{o.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>

					{error && (
						<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend">
							{error}
						</p>
					)}

					<DialogFooter>
						<Button onClick={onClose} type="button" variant="outline">
							Cancel
						</Button>
						<Button disabled={isSaving} type="submit">
							{isSaving ? "Saving…" : expense ? "Save changes" : "Add expense"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
