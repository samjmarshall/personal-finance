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
	CommitmentKind,
	EXPENSE_CATEGORIES,
	toCommitmentKind,
} from "~/lib/constants";
import { fromDateInput, toDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { SelectField, toOptions } from "../select-field";

type Expense = RouterOutputs["expense"]["list"][number];

const FORTNIGHTS_PER_MONTH = 26 / 12;

const BASIS_OPTIONS = [
	{ value: "fortnight", label: "Fortnight" },
	{ value: "month", label: "Month" },
	{ value: "year", label: "Year" },
] as const;

const KIND_OPTIONS = [
	{ value: CommitmentKind.Recurring, label: "Recurring" },
	{ value: CommitmentKind.OneTime, label: "One-time" },
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
	const [kind, setKind] = useState(() => toCommitmentKind(expense?.kind));
	const [expectedDate, setExpectedDate] = useState(() =>
		toDateInput(expense?.expectedDate ?? new Date()),
	);
	const [amount, setAmount] = useState(() => {
		if (!expense) return "";
		const value =
			expense.kind === CommitmentKind.OneTime
				? (expense.amount ?? 0)
				: expense.month || expense.fortnight || expense.year;
		return value ? String(Number(value.toFixed(2))) : "";
	});
	const [error, setError] = useState<string | null>(null);
	const isOneTime = kind === CommitmentKind.OneTime;

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

		const date = isOneTime ? fromDateInput(expectedDate) : null;
		if (isOneTime && !date) return setError("Please enter a valid date.");

		// One-time carries amount + expectedDate; its three cadence figures are
		// unused (zeroed). Recurring is the inverse: derived cadence, no one-time pair.
		const payload = isOneTime
			? {
					name: name.trim(),
					category,
					kind,
					amount: value,
					expectedDate: date,
					fortnight: 0,
					month: 0,
					year: 0,
				}
			: {
					name: name.trim(),
					category,
					kind,
					amount: null,
					expectedDate: null,
					...deriveAmounts(value, basis),
				};

		if (expense) update.mutate({ id: expense.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
					<DialogDescription>
						{isOneTime
							? "A single expected spend on a date — track what's consumed against it."
							: "Enter the amount on any cadence — we'll work out the rest."}
					</DialogDescription>
				</DialogHeader>
				{/* noValidate: the required date input is React-validated (onSubmit), so
			    suppress the native bubble that would clash with the error banner below. */}
				<form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
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
						<SelectField
							className="w-full"
							id="exp-cat"
							items={toOptions(
								categoryOptions.includes(category)
									? categoryOptions
									: [category, ...categoryOptions],
							)}
							onValueChange={(v) => v && setCategory(v)}
							value={category}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="exp-kind">Type</FieldLabel>
						<SelectField
							className="w-full"
							id="exp-kind"
							items={KIND_OPTIONS}
							onValueChange={(v) => v && setKind(v)}
							value={kind}
						/>
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
						{isOneTime ? (
							<Field>
								<FieldLabel htmlFor="exp-date">Expected date</FieldLabel>
								<Input
									id="exp-date"
									onChange={(e) => setExpectedDate(e.target.value)}
									required
									type="date"
									value={expectedDate}
								/>
							</Field>
						) : (
							<Field>
								<FieldLabel htmlFor="exp-basis">Per</FieldLabel>
								<SelectField
									className="w-full"
									id="exp-basis"
									items={BASIS_OPTIONS}
									onValueChange={(v) => v && setBasis(v)}
									value={basis}
								/>
							</Field>
						)}
					</div>

					{error && (
						<p
							className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend"
							role="alert"
						>
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
