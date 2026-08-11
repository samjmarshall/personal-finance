"use client";

import { useEffect, useState } from "react";

import { Modal } from "~/app/_components/ui/modal";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { api, type RouterOutputs } from "~/trpc/react";

type Income = RouterOutputs["income"]["list"][number];

const FORTNIGHTS_PER_YEAR = 26;
const MONTHS_PER_YEAR = 12;

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
	const [fortnight, setFortnight] = useState("");

	useEffect(() => {
		if (open) {
			setPerson(income?.person ?? "");
			setSource(income?.source ?? "");
			setFortnight(income ? String(income.fortnight) : "");
		}
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
		const perFortnight = Number(fortnight) || 0;
		const payload = {
			person: person.trim(),
			source: source.trim(),
			fortnight: perFortnight,
			month: (perFortnight * FORTNIGHTS_PER_YEAR) / MONTHS_PER_YEAR,
			year: perFortnight * FORTNIGHTS_PER_YEAR,
		};
		if (income) update.mutate({ id: income.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Modal
			onClose={onClose}
			open={open}
			title={income ? "Edit income" : "Add income"}
		>
			<form className="flex flex-col gap-4" onSubmit={submit}>
				<Field>
					<FieldLabel htmlFor="income-person">Person</FieldLabel>
					<Input
						id="income-person"
						onChange={(e) => setPerson(e.target.value)}
						placeholder="e.g. Sam"
						required
						value={person}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="income-source">Source</FieldLabel>
					<Input
						id="income-source"
						onChange={(e) => setSource(e.target.value)}
						placeholder="e.g. Salary"
						required
						value={source}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="income-fortnight">
						Amount per fortnight
					</FieldLabel>
					<Input
						aria-describedby="income-fortnight-hint"
						id="income-fortnight"
						inputMode="decimal"
						min="0"
						onChange={(e) => setFortnight(e.target.value)}
						placeholder="0.00"
						required
						step="0.01"
						type="number"
						value={fortnight}
					/>
					<FieldDescription id="income-fortnight-hint">
						Monthly and yearly figures are calculated automatically.
					</FieldDescription>
				</Field>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={onClose} type="button" variant="ghost">
						Cancel
					</Button>
					<Button disabled={pending} type="submit">
						{pending ? "Saving..." : income ? "Save changes" : "Add income"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
