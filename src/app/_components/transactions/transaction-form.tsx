"use client";

import { useEffect, useState } from "react";

import { Modal } from "~/app/_components/ui/modal";
import {
	Button,
	Field,
	Input,
	Select,
	Textarea,
} from "~/app/_components/ui/primitives";
import { FREQUENCIES, PRIORITIES } from "~/lib/constants";
import { api, type RouterOutputs } from "~/trpc/react";

type Transaction = RouterOutputs["transaction"]["list"]["items"][number];

function toDateInput(d: Date | string) {
	const date = typeof d === "string" ? new Date(d) : d;
	return date.toISOString().slice(0, 10);
}

export function TransactionForm({
	open,
	onClose,
	transaction,
	categories,
}: {
	open: boolean;
	onClose: () => void;
	transaction: Transaction | null;
	categories: string[];
}) {
	const utils = api.useUtils();
	const [date, setDate] = useState(toDateInput(new Date()));
	const [description, setDescription] = useState("");
	const [amount, setAmount] = useState("");
	const [category, setCategory] = useState("");
	const [frequency, setFrequency] = useState<string>("One-off");
	const [priority, setPriority] = useState<string>("Nice to Have");
	const [notes, setNotes] = useState("");

	useEffect(() => {
		if (!open) return;
		setDate(toDateInput(transaction?.date ?? new Date()));
		setDescription(transaction?.description ?? "");
		setAmount(transaction ? String(transaction.amount) : "");
		setCategory(transaction?.category ?? "");
		setFrequency(transaction?.frequency ?? "One-off");
		setPriority(transaction?.priority ?? "Nice to Have");
		setNotes(transaction?.notes ?? "");
	}, [open, transaction]);

	const onSuccess = async () => {
		await Promise.all([
			utils.transaction.list.invalidate(),
			utils.transaction.summary.invalidate(),
			utils.transaction.categories.invalidate(),
		]);
		onClose();
	};
	const create = api.transaction.create.useMutation({ onSuccess });
	const update = api.transaction.update.useMutation({ onSuccess });
	const pending = create.isPending || update.isPending;

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const payload = {
			date: new Date(`${date}T00:00:00`),
			description: description.trim(),
			amount: Number(amount) || 0,
			category: category.trim() || "Uncategorised",
			frequency,
			priority,
			notes: notes.trim() || null,
		};
		if (transaction) update.mutate({ id: transaction.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Modal
			onClose={onClose}
			open={open}
			title={transaction ? "Edit transaction" : "Add transaction"}
		>
			<form className="flex flex-col gap-4" onSubmit={submit}>
				<div className="grid grid-cols-2 gap-4">
					<Field label="Date">
						<Input
							onChange={(e) => setDate(e.target.value)}
							required
							type="date"
							value={date}
						/>
					</Field>
					<Field hint="Positive = spend, negative = refund" label="Amount">
						<Input
							inputMode="decimal"
							onChange={(e) => setAmount(e.target.value)}
							placeholder="0.00"
							required
							step="0.01"
							type="number"
							value={amount}
						/>
					</Field>
				</div>
				<Field label="Description">
					<Input
						onChange={(e) => setDescription(e.target.value)}
						placeholder="e.g. Woolworths"
						required
						value={description}
					/>
				</Field>
				<Field label="Category">
					<Input
						list="tx-categories"
						onChange={(e) => setCategory(e.target.value)}
						placeholder="e.g. Groceries"
						value={category}
					/>
					<datalist id="tx-categories">
						{categories.map((c) => (
							<option key={c} value={c} />
						))}
					</datalist>
				</Field>
				<div className="grid grid-cols-2 gap-4">
					<Field label="Frequency">
						<Select
							onChange={(e) => setFrequency(e.target.value)}
							value={frequency}
						>
							{FREQUENCIES.map((f) => (
								<option key={f} value={f}>
									{f}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Priority">
						<Select
							onChange={(e) => setPriority(e.target.value)}
							value={priority}
						>
							{PRIORITIES.map((p) => (
								<option key={p} value={p}>
									{p}
								</option>
							))}
						</Select>
					</Field>
				</div>
				<Field label="Notes" optional>
					<Textarea
						onChange={(e) => setNotes(e.target.value)}
						placeholder="Optional context"
						rows={2}
						value={notes}
					/>
				</Field>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={onClose} type="button" variant="ghost">
						Cancel
					</Button>
					<Button disabled={pending} type="submit">
						{pending
							? "Saving..."
							: transaction
								? "Save changes"
								: "Add transaction"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
