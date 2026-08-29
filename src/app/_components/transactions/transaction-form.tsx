"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/ui/combobox";
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
import {
	SelectField,
	type SelectFieldOption,
	toOptions,
} from "../select-field";

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
	managedCategories,
	expenses,
}: {
	open: boolean;
	onClose: () => void;
	transaction: Transaction | null;
	categories: string[];
	// Managed rows with ids for the FK picker; `categories` above is name-only
	// (the free-text combobox's options), so it can't feed the id-valued picker.
	managedCategories: RouterOutputs["category"]["list"];
	expenses: RouterOutputs["expense"]["list"];
}) {
	const utils = api.useUtils();
	const [date, setDate] = useState(toDateInput(new Date()));
	const [description, setDescription] = useState("");
	const [amount, setAmount] = useState("");
	const [category, setCategory] = useState("");
	// Combobox input text is controlled: cleared on open so the full list shows,
	// restored to the committed label on close so abandoned filter text can't linger.
	const [categoryInput, setCategoryInput] = useState("");
	// Mirrors `category` synchronously so the close handler restores the label
	// without reading a stale closure of the state value.
	const categoryRef = useRef("");
	const commitCategory = useCallback((value: string) => {
		setCategory(value);
		setCategoryInput(value);
		categoryRef.current = value;
	}, []);
	const [frequency, setFrequency] = useState<Frequency>(Frequency.OneOff);
	const [priority, setPriority] = useState<Priority>(Priority.NiceToHave);
	const [notes, setNotes] = useState("");
	// Empty string is the "— None —" option; converted to null on submit.
	const [expenseId, setExpenseId] = useState<number | null>(null);
	const [expenseCategoryId, setExpenseCategoryId] = useState<number | null>(
		null,
	);

	useEffect(() => {
		if (!open) return;
		setDate(toDateInput(transaction?.date ?? new Date()));
		setDescription(transaction?.description ?? "");
		setAmount(transaction ? String(transaction.amount) : "");
		commitCategory(transaction?.category ?? "");
		setFrequency(toFrequency(transaction?.frequency));
		setPriority(toPriority(transaction?.priority));
		setNotes(transaction?.notes ?? "");
		setExpenseId(transaction?.expenseId ?? null);
		setExpenseCategoryId(transaction?.expenseCategoryId ?? null);
	}, [open, transaction, commitCategory]);

	const onSuccess = async () => {
		await Promise.all([
			utils.transaction.list.invalidate(),
			utils.transaction.summary.invalidate(),
		]);
		onClose();
	};
	const create = api.transaction.create.useMutation({ onSuccess });
	const update = api.transaction.update.useMutation({ onSuccess });
	const pending = create.isPending || update.isPending;

	// A saved transaction can hold a category since deleted from the managed list
	// (or the "Uncategorised" default); inject it so the picker can display it.
	const categoryOptions =
		category && !categories.includes(category)
			? [category, ...categories]
			: categories;

	const expenseOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...expenses.map((e) => ({ value: String(e.id), label: e.name })),
	];

	// Categories are chosen from the managed list, never invented mid-entry.
	const expenseCategoryOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...managedCategories.map((c) => ({
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
			category: category.trim() || "Uncategorised",
			frequency,
			priority,
			notes: notes.trim() || null,
			expenseId,
			expenseCategoryId,
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
						<Combobox
							inputValue={categoryInput}
							items={categoryOptions}
							onInputValueChange={setCategoryInput}
							onOpenChange={(isOpen) => {
								// Base UI filters items by the input text, so open with an
								// empty query to show the full list; on close restore the
								// committed label (from the ref, to dodge a stale closure).
								setCategoryInput(isOpen ? "" : categoryRef.current);
							}}
							onValueChange={(next) => commitCategory(next ?? "")}
							value={category || null}
						>
							<ComboboxInput
								className="w-full"
								id="tx-category"
								placeholder="e.g. Groceries"
								showClear
							/>
							<ComboboxContent>
								<ComboboxEmpty>No matching categories</ComboboxEmpty>
								<ComboboxList>
									{(item: string) => (
										<ComboboxItem key={item} value={item}>
											{item}
										</ComboboxItem>
									)}
								</ComboboxList>
							</ComboboxContent>
						</Combobox>
					</Field>
					<Field>
						<FieldLabel htmlFor="tx-expense-category">
							Expense category
							<FieldOptional />
						</FieldLabel>
						<SelectField
							className="w-full"
							id="tx-expense-category"
							items={expenseCategoryOptions}
							onValueChange={(v) => setExpenseCategoryId(v ? Number(v) : null)}
							value={expenseCategoryId ? String(expenseCategoryId) : ""}
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
							onValueChange={(v) => setExpenseId(v ? Number(v) : null)}
							value={expenseId ? String(expenseId) : ""}
						/>
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
