"use client";

import { useEffect, useState } from "react";
import {
	SelectField,
	type SelectFieldOption,
	toOptions,
} from "~/components/select-field";
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
import { Textarea } from "~/components/ui/textarea";
import { Frequency, Priority, toFrequency, toPriority } from "~/lib/constants";
import { toDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

type Transaction = RouterOutputs["transaction"]["list"]["items"][number];

const FREQUENCY_OPTIONS: SelectFieldOption<Frequency>[] = toOptions(
	Object.values(Frequency),
);
const PRIORITY_OPTIONS: SelectFieldOption<Priority>[] = toOptions(
	Object.values(Priority),
);

export function TransactionForm({
	open,
	onClose,
	transaction,
	categories,
	expenses,
}: {
	open: boolean;
	onClose: () => void;
	transaction: Transaction | null;
	categories: RouterOutputs["category"]["list"];
	expenses: RouterOutputs["expense"]["list"];
}) {
	const utils = api.useUtils();
	const [date, setDate] = useState(toDateInput(new Date()));
	const [description, setDescription] = useState("");
	const [amount, setAmount] = useState("");
	const [group, setGroup] = useState("");
	const [frequency, setFrequency] = useState<Frequency>(Frequency.OneOff);
	const [priority, setPriority] = useState<Priority>(Priority.NiceToHave);
	const [notes, setNotes] = useState("");
	// Empty string is the "— None —" option; converted to null on submit.
	const [expenseId, setExpenseId] = useState<number | null>(null);
	// undefined: unlinked from the saved Expense, no Category picked since.
	const [categoryId, setCategoryId] = useState<number | null | undefined>(null);

	useEffect(() => {
		if (!open) return;
		setDate(toDateInput(transaction?.date ?? new Date()));
		setDescription(transaction?.description ?? "");
		setAmount(transaction ? String(transaction.amount) : "");
		setGroup(transaction?.group ?? "");
		setFrequency(toFrequency(transaction?.frequency));
		setPriority(toPriority(transaction?.priority));
		setNotes(transaction?.notes ?? "");
		setExpenseId(transaction?.expenseId ?? null);
		setCategoryId(transaction?.categoryId ?? null);
	}, [open, transaction]);

	const onSuccess = async () => {
		await Promise.all([
			utils.transaction.list.invalidate(),
			utils.transaction.summary.invalidate(),
			utils.transaction.unplanned.invalidate(),
			// A transaction's amount/expenseId feeds the Planned consumed/remaining
			// read-model — refresh it so those figures don't go stale.
			utils.expense.consumption.invalidate(),
		]);
		onClose();
	};
	const create = api.transaction.create.useMutation({ onSuccess });
	const update = api.transaction.update.useMutation({ onSuccess });
	const pending = create.isPending || update.isPending;

	const expenseOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...expenses.map((e) => ({ value: String(e.id), label: e.name })),
	];

	// adr025: a linked Expense sets the Category, so the picker shows the
	// Expense's and locks.
	const linkedExpense = expenses.find((e) => e.id === expenseId);
	const savedExpense = expenses.find((e) => e.id === transaction?.expenseId);
	const shownCategoryId =
		linkedExpense?.categoryId ??
		(categoryId === undefined ? savedExpense?.categoryId : categoryId);
	// One line in both states, so the swap never resizes the centred dialog.
	const categoryHint =
		expenseId === null
			? "Linking an Expense sets this."
			: "Set by the Expense. Choose None to edit.";

	// Clearing the Expense keeps its Category, still editable before saving. For
	// the saved Expense the server copies it, so a stale Expense list can't lose it.
	function pickExpense(value: string | null) {
		const next = value ? Number(value) : null;
		if (next === null && expenseId !== null) {
			setCategoryId(
				expenseId === transaction?.expenseId
					? undefined
					: (linkedExpense?.categoryId ?? null),
			);
		}
		setExpenseId(next);
	}

	// Categories are chosen from the managed list, never invented mid-entry.
	const categoryOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...categories.map((c) => ({
			value: String(c.id),
			label: c.name,
		})),
	];

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const payload = {
			date: new Date(`${date}T00:00:00`),
			description: description.trim(),
			amount: Number(amount) || 0,
			group: group.trim() || "Uncategorised",
			frequency,
			priority,
			notes: notes.trim() || null,
			expenseId,
			categoryId: expenseId === null ? categoryId : null,
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
						<FieldLabel htmlFor="tx-group">
							Group
							<FieldOptional />
						</FieldLabel>
						<Input
							id="tx-group"
							onChange={(e) => setGroup(e.target.value)}
							placeholder="e.g. Groceries"
							value={group}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="tx-expense">
							Expense
							<FieldOptional />
						</FieldLabel>
						<SelectField
							className="w-full"
							id="tx-expense"
							items={expenseOptions}
							onValueChange={pickExpense}
							value={expenseId ? String(expenseId) : ""}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="tx-category">
							Category
							<FieldOptional />
						</FieldLabel>
						{/* Locked reads muted, not faded: its value is still the answer. */}
						<SelectField
							aria-describedby="tx-category-hint"
							className="w-full data-readonly:cursor-default data-readonly:bg-muted data-readonly:text-muted-foreground dark:data-readonly:bg-muted"
							id="tx-category"
							items={categoryOptions}
							onValueChange={(v) => setCategoryId(v ? Number(v) : null)}
							readOnly={expenseId !== null}
							value={shownCategoryId ? String(shownCategoryId) : ""}
						/>
						<FieldDescription aria-live="polite" id="tx-category-hint">
							{categoryHint}
						</FieldDescription>
					</Field>
					<div className="grid grid-cols-2 gap-4">
						<Field>
							<FieldLabel htmlFor="tx-frequency">Frequency</FieldLabel>
							<SelectField
								className="w-full"
								id="tx-frequency"
								items={FREQUENCY_OPTIONS}
								onValueChange={(v) => v && setFrequency(v)}
								value={frequency}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="tx-priority">Priority</FieldLabel>
							<SelectField
								className="w-full"
								id="tx-priority"
								items={PRIORITY_OPTIONS}
								onValueChange={(v) => v && setPriority(v)}
								value={priority}
							/>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="tx-notes">
							Notes
							<FieldOptional />
						</FieldLabel>
						<Textarea
							className="wrap-anywhere"
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
