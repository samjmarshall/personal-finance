"use client";

import { useEffect, useState } from "react";
import { SelectField, toOptions } from "~/components/select-field";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldOptional,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	CommitmentKind,
	EXPENSE_CATEGORIES,
	toCommitmentKind,
} from "~/lib/constants";
import { fromDateInput, toDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

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

// Seed the amount field: one-time reads its own amount, recurring the first non-zero cadence figure.
function seedAmount(expense: Expense | null) {
	if (!expense) return "";
	const value =
		expense.kind === CommitmentKind.OneTime
			? (expense.amount ?? 0)
			: expense.month || expense.fortnight || expense.year;
	return value ? String(Number(value.toFixed(2))) : "";
}

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
	const [name, setName] = useState("");
	const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[1]);
	const [basis, setBasis] = useState<"fortnight" | "month" | "year">("month");
	const [kind, setKind] = useState(CommitmentKind.Recurring);
	const [expectedDate, setExpectedDate] = useState(() =>
		toDateInput(new Date()),
	);
	const [amount, setAmount] = useState("");
	// Timing (recurring only): empty string = unset, so the projection smears.
	const [dueDay, setDueDay] = useState("");
	const [dueMonth, setDueMonth] = useState("");
	const [error, setError] = useState<string | null>(null);
	const isOneTime = kind === CommitmentKind.OneTime;

	// Reseed on each open: the dialog stays mounted, so a reused Add form would
	// otherwise show the previous entry's values.
	useEffect(() => {
		if (!open) return;
		setName(expense?.name ?? "");
		setCategory(expense?.category ?? EXPENSE_CATEGORIES[1]);
		setBasis("month");
		setKind(toCommitmentKind(expense?.kind));
		setExpectedDate(toDateInput(expense?.expectedDate ?? new Date()));
		setAmount(seedAmount(expense));
		setDueDay(expense?.dueDay != null ? String(expense.dueDay) : "");
		setDueMonth(expense?.dueMonth != null ? String(expense.dueMonth) : "");
		setError(null);
	}, [open, expense]);

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

		// Empty Timing fields stay null (row smears); submitting null on update
		// clears a stored value, so a cleared field genuinely reverts to a smear.
		const day = dueDay ? Number.parseInt(dueDay, 10) : null;
		const month = dueMonth ? Number.parseInt(dueMonth, 10) : null;
		if (!isOneTime && day != null && (day < 1 || day > 31))
			return setError("Due day must be between 1 and 31.");
		if (!isOneTime && month != null && (month < 1 || month > 12))
			return setError("Due month must be between 1 and 12.");

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
					dueDay: day,
					dueMonth: month,
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

					{!isOneTime && (
						<div className="flex flex-col gap-2">
							<div className="grid grid-cols-2 gap-3">
								<Field>
									<FieldLabel htmlFor="exp-due-day">
										Due day
										<FieldOptional />
									</FieldLabel>
									<Input
										aria-describedby="exp-timing-hint"
										id="exp-due-day"
										inputMode="numeric"
										max="31"
										min="1"
										onChange={(e) => setDueDay(e.target.value)}
										placeholder="—"
										step="1"
										type="number"
										value={dueDay}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="exp-due-month">
										Due month
										<FieldOptional />
									</FieldLabel>
									<Input
										aria-describedby="exp-timing-hint"
										id="exp-due-month"
										inputMode="numeric"
										max="12"
										min="1"
										onChange={(e) => setDueMonth(e.target.value)}
										placeholder="—"
										step="1"
										type="number"
										value={dueMonth}
									/>
								</Field>
							</div>
							<FieldDescription id="exp-timing-hint">
								Set a due day for a monthly bill, or add a month too for a
								once-a-year one. Leave blank to spread the cost evenly.
							</FieldDescription>
						</div>
					)}

					{error && (
						<p
							className="rounded-md border border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] px-3 py-2 text-[var(--badge-spend-fg)] text-sm"
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
