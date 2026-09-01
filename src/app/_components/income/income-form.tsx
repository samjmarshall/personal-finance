"use client";

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { CommitmentKind, toCommitmentKind } from "~/lib/constants";
import { fromDateInput, toDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { SelectField } from "../select-field";

type Income = RouterOutputs["income"]["list"][number];

const FORTNIGHTS_PER_YEAR = 26;
const MONTHS_PER_YEAR = 12;

const KIND_OPTIONS = [
	{ value: CommitmentKind.Recurring, label: "Recurring" },
	{ value: CommitmentKind.OneTime, label: "One-time" },
] as const;

// Seed the amount field: one-time reads its own amount, recurring the per-fortnight figure.
function seedAmount(income: Income | null) {
	if (!income) return "";
	const value =
		income.kind === CommitmentKind.OneTime
			? (income.amount ?? 0)
			: income.fortnight;
	return value ? String(Number(value.toFixed(2))) : "";
}

export function IncomeForm({
	open,
	onClose,
	income,
}: {
	open: boolean;
	onClose: () => void;
	income: Income | null;
}) {
	const utils = api.useUtils();
	const [person, setPerson] = useState("");
	const [source, setSource] = useState("");
	const [kind, setKind] = useState(CommitmentKind.Recurring);
	const [expectedDate, setExpectedDate] = useState(() =>
		toDateInput(new Date()),
	);
	const [amount, setAmount] = useState("");
	const [error, setError] = useState<string | null>(null);
	const isOneTime = kind === CommitmentKind.OneTime;

	// Reseed on each open: the dialog stays mounted, so a reused Add form would
	// otherwise show the previous entry's values.
	useEffect(() => {
		if (!open) return;
		setPerson(income?.person ?? "");
		setSource(income?.source ?? "");
		setKind(toCommitmentKind(income?.kind));
		setExpectedDate(toDateInput(income?.expectedDate ?? new Date()));
		setAmount(seedAmount(income));
		setError(null);
	}, [open, income]);

	const onSuccess = async () => {
		await utils.income.list.invalidate();
		onClose();
	};
	const create = api.income.create.useMutation({ onSuccess });
	const update = api.income.update.useMutation({ onSuccess });
	const pending = create.isPending || update.isPending;

	function submit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const value = Number.parseFloat(amount);
		if (!person.trim()) return setError("Please enter a person.");
		if (!source.trim()) return setError("Please enter a source.");
		if (Number.isNaN(value) || value < 0)
			return setError("Please enter a valid amount.");

		const date = isOneTime ? fromDateInput(expectedDate) : null;
		if (isOneTime && !date) return setError("Please enter a valid date.");

		// One-time carries amount + expectedDate; its three cadence figures are
		// unused (zeroed). Recurring is the inverse: derived cadence, no one-time pair.
		const payload = isOneTime
			? {
					person: person.trim(),
					source: source.trim(),
					kind,
					amount: value,
					expectedDate: date,
					fortnight: 0,
					month: 0,
					year: 0,
				}
			: {
					person: person.trim(),
					source: source.trim(),
					kind,
					amount: null,
					expectedDate: null,
					fortnight: value,
					month: (value * FORTNIGHTS_PER_YEAR) / MONTHS_PER_YEAR,
					year: value * FORTNIGHTS_PER_YEAR,
				};

		if (income) update.mutate({ id: income.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{income ? "Edit income" : "Add income"}</DialogTitle>
				</DialogHeader>
				{/* noValidate: the required date input is React-validated (onSubmit), so
			    suppress the native bubble that would clash with the error banner below. */}
				<form className="flex flex-col gap-4" noValidate onSubmit={submit}>
					<Field>
						<FieldLabel htmlFor="income-person">Person</FieldLabel>
						<Input
							id="income-person"
							onChange={(e) => setPerson(e.target.value)}
							placeholder="e.g. Sam"
							value={person}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="income-source">Source</FieldLabel>
						<Input
							id="income-source"
							onChange={(e) => setSource(e.target.value)}
							placeholder="e.g. Salary"
							value={source}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="income-kind">Type</FieldLabel>
						<SelectField
							className="w-full"
							id="income-kind"
							items={KIND_OPTIONS}
							onValueChange={(v) => v && setKind(v)}
							value={kind}
						/>
					</Field>
					{isOneTime ? (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field>
								<FieldLabel htmlFor="income-amount">Amount</FieldLabel>
								<Input
									id="income-amount"
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
								<FieldLabel htmlFor="income-date">Expected date</FieldLabel>
								<Input
									id="income-date"
									onChange={(e) => setExpectedDate(e.target.value)}
									required
									type="date"
									value={expectedDate}
								/>
							</Field>
						</div>
					) : (
						<Field>
							<FieldLabel htmlFor="income-fortnight">
								Amount per fortnight
							</FieldLabel>
							<Input
								aria-describedby="income-fortnight-hint"
								id="income-fortnight"
								inputMode="decimal"
								min="0"
								onChange={(e) => setAmount(e.target.value)}
								placeholder="0.00"
								step="0.01"
								type="number"
								value={amount}
							/>
							<FieldDescription id="income-fortnight-hint">
								Monthly and yearly figures are calculated automatically.
							</FieldDescription>
						</Field>
					)}

					{error && (
						<p
							className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend"
							role="alert"
						>
							{error}
						</p>
					)}

					<DialogFooter>
						<Button onClick={onClose} type="button" variant="ghost">
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? "Saving..." : income ? "Save changes" : "Add income"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
