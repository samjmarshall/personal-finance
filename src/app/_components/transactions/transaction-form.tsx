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
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldOptional,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
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
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{transaction ? "Edit transaction" : "Add transaction"}
					</DialogTitle>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={submit}>
					<div className="grid grid-cols-2 gap-4">
						<Field>
							<FieldLabel htmlFor="tx-date">Date</FieldLabel>
							<Input
								id="tx-date"
								onChange={(e) => setDate(e.target.value)}
								required
								type="date"
								value={date}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="tx-amount">Amount</FieldLabel>
							<Input
								aria-describedby="tx-amount-hint"
								id="tx-amount"
								inputMode="decimal"
								onChange={(e) => setAmount(e.target.value)}
								placeholder="0.00"
								required
								step="0.01"
								type="number"
								value={amount}
							/>
							<FieldDescription id="tx-amount-hint">
								Positive = spend, negative = refund
							</FieldDescription>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="tx-description">Description</FieldLabel>
						<Input
							id="tx-description"
							onChange={(e) => setDescription(e.target.value)}
							placeholder="e.g. Woolworths"
							required
							value={description}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="tx-category">Category</FieldLabel>
						<Input
							id="tx-category"
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
						<Field>
							<FieldLabel htmlFor="tx-frequency">Frequency</FieldLabel>
							<Select
								onValueChange={(v) => setFrequency(v as string)}
								value={frequency}
							>
								<SelectTrigger className="w-full" id="tx-frequency">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FREQUENCIES.map((f) => (
										<SelectItem key={f} value={f}>
											{f}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel htmlFor="tx-priority">Priority</FieldLabel>
							<Select
								onValueChange={(v) => setPriority(v as string)}
								value={priority}
							>
								<SelectTrigger className="w-full" id="tx-priority">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRIORITIES.map((p) => (
										<SelectItem key={p} value={p}>
											{p}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="tx-notes">
							Notes
							<FieldOptional />
						</FieldLabel>
						<Textarea
							id="tx-notes"
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Optional context"
							rows={2}
							value={notes}
						/>
					</Field>
					<DialogFooter>
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
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
