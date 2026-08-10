"use client";

import { useEffect, useState } from "react";

import { Modal } from "~/app/_components/ui/modal";
import { Button, Field, Input } from "~/app/_components/ui/primitives";
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
			open={open}
			onClose={onClose}
			title={income ? "Edit income" : "Add income"}
		>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<Field label="Person">
					<Input
						value={person}
						onChange={(e) => setPerson(e.target.value)}
						placeholder="e.g. Sam"
						required
					/>
				</Field>
				<Field label="Source">
					<Input
						value={source}
						onChange={(e) => setSource(e.target.value)}
						placeholder="e.g. Salary"
						required
					/>
				</Field>
				<Field
					label="Amount per fortnight"
					hint="Monthly and yearly figures are calculated automatically."
				>
					<Input
						type="number"
						inputMode="decimal"
						step="0.01"
						min="0"
						value={fortnight}
						onChange={(e) => setFortnight(e.target.value)}
						placeholder="0.00"
						required
					/>
				</Field>
				<div className="mt-2 flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={pending}>
						{pending ? "Saving..." : income ? "Save changes" : "Add income"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
