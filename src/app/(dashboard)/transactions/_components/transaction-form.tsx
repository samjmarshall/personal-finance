"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
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
	FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useRestoreFocus } from "~/hooks/use-restore-focus";
import {
	Frequency,
	Priority,
	Provenance,
	toFrequency,
	toPriority,
} from "~/lib/constants";
import { toDateInput } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import {
	type CategoryLink,
	expensesInCategory,
	pickCategory,
	pickExpense,
} from "./category-expense-link";
import { submittedDate } from "./submitted-date";

type Transaction = RouterOutputs["transaction"]["list"]["items"][number];

// Locked reads muted, not faded: its value is still the answer. Dark swaps
// the fill for a dashed edge: an open field there is filled too, so a fill looks open.
const BANK_OWNED_CLASS =
	"read-only:cursor-default read-only:bg-muted read-only:text-muted-foreground dark:read-only:border-dashed dark:read-only:bg-transparent";

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
	// The Category shown, which for a linked row is its Expense's (adr025).
	const [link, setLink] = useState<CategoryLink>({
		categoryId: null,
		expenseId: null,
	});
	const { categoryId, expenseId } = link;

	// Read at open only: a refetched Expense list must not reset a half-done edit.
	const savedCategoryId = useEffectEvent(
		(t: Transaction | null) =>
			expenses.find((e) => e.id === t?.expenseId)?.categoryId ??
			t?.categoryId ??
			null,
	);

	useEffect(() => {
		if (!open) return;
		setDate(toDateInput(transaction?.date ?? new Date()));
		setDescription(transaction?.description ?? "");
		setAmount(transaction ? String(transaction.amount) : "");
		setGroup(transaction?.group ?? "");
		setFrequency(toFrequency(transaction?.frequency));
		setPriority(toPriority(transaction?.priority));
		setNotes(transaction?.notes ?? "");
		setLink({
			categoryId: savedCategoryId(transaction),
			expenseId: transaction?.expenseId ?? null,
		});
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
	const rememberFocus = useRestoreFocus(pending);
	const descriptionRef = useRef<HTMLInputElement>(null);
	// A bank description runs long and leads with the merchant, so open at its start.
	const focusDescriptionStart = () => {
		descriptionRef.current?.setSelectionRange(0, 0);
		return descriptionRef.current;
	};

	// Categories are chosen from the managed list, never invented mid-entry.
	const categoryOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...categories.map((c) => ({
			value: String(c.id),
			label: c.name,
		})),
	];

	// A Category narrows the Expenses to the ones filed under it.
	const shownExpenses = expensesInCategory(expenses, categoryId);
	const expenseOptions: SelectFieldOption<string>[] = [
		{ value: "", label: "— None —" },
		...shownExpenses.map((e) => ({ value: String(e.id), label: e.name })),
	];
	// One line in every state, so the swap never resizes the centred dialog.
	const expenseHint =
		categoryId === null
			? "Pick a Category to narrow this list."
			: shownExpenses.length === 0
				? "No planned expenses in this Category."
				: "Showing expenses in this Category.";

	// Each sync rewrites a synced row's date and amount, so the server refuses an edit.
	const bankOwned =
		!!transaction && transaction.provenance !== Provenance.Manual;

	// The saved Expense is missing from a stale list, so its Category is unknown here.
	const savedCategoryUnknown =
		transaction?.expenseId != null &&
		!expenses.some((e) => e.id === transaction.expenseId);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const payload = {
			date: submittedDate(date, transaction?.date),
			description: description.trim(),
			amount: Number(amount) || 0,
			group: group.trim() || "Uncategorised",
			frequency,
			priority,
			notes: notes.trim() || null,
			expenseId,
			// Unknown Category on unlink: undefined lets the server copy it back.
			categoryId:
				expenseId !== null
					? null
					: categoryId === null && savedCategoryUnknown
						? undefined
						: categoryId,
		};
		rememberFocus();
		if (transaction) update.mutate({ id: transaction.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Dialog
			onOpenChange={(next, eventDetails) => {
				if (pending) eventDetails.cancel();
				else if (!next) onClose();
			}}
			open={open}
		>
			{/* A synced row opens on its first field you can change. */}
			<DialogContent
				initialFocus={bankOwned ? focusDescriptionStart : undefined}
			>
				<DialogHeader>
					<DialogTitle>
						{transaction ? "Edit transaction" : "Add transaction"}
					</DialogTitle>
				</DialogHeader>
				<form className="flex min-w-0 flex-col gap-4" onSubmit={submit}>
					<FieldSet disabled={pending}>
						<div className="flex flex-col gap-2">
							<div className="grid grid-cols-2 gap-4">
								<Field>
									<FieldLabel htmlFor="tx-date">Date</FieldLabel>
									<Input
										aria-describedby={bankOwned ? "tx-amount-hint" : undefined}
										// Only when locked: a save disables every field, which :read-only matches too.
										className={bankOwned ? BANK_OWNED_CLASS : undefined}
										id="tx-date"
										onChange={(e) => setDate(e.target.value)}
										readOnly={bankOwned}
										required
										// Its 3 day/month/year stops do nothing when locked.
										tabIndex={bankOwned ? -1 : undefined}
										type="date"
										value={date}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="tx-amount">Amount</FieldLabel>
									<Input
										aria-describedby="tx-amount-hint"
										className={bankOwned ? BANK_OWNED_CLASS : undefined}
										id="tx-amount"
										inputMode="decimal"
										onChange={(e) => setAmount(e.target.value)}
										placeholder="0.00"
										readOnly={bankOwned}
										required
										step="0.01"
										type="number"
										value={amount}
									/>
									{!bankOwned && (
										<FieldDescription id="tx-amount-hint">
											Positive = spend, negative = refund
										</FieldDescription>
									)}
								</Field>
							</div>
							{/* Under both fields, since it locks both. */}
							{bankOwned && (
								<FieldDescription id="tx-amount-hint">
									Date and amount come from your bank.
								</FieldDescription>
							)}
						</div>
						<Field>
							<FieldLabel htmlFor="tx-description">Description</FieldLabel>
							<Input
								id="tx-description"
								onChange={(e) => setDescription(e.target.value)}
								placeholder="e.g. Woolworths"
								ref={descriptionRef}
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
							<FieldLabel htmlFor="tx-category">
								Category
								<FieldOptional />
							</FieldLabel>
							<SelectField
								className="w-full"
								disabled={pending}
								id="tx-category"
								items={categoryOptions}
								onValueChange={(v) =>
									setLink(pickCategory(link, v ? Number(v) : null, expenses))
								}
								value={categoryId ? String(categoryId) : ""}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="tx-expense">
								Expense
								<FieldOptional />
							</FieldLabel>
							<SelectField
								aria-describedby="tx-expense-hint"
								className="w-full"
								disabled={pending}
								id="tx-expense"
								items={expenseOptions}
								onValueChange={(v) =>
									setLink(pickExpense(link, v ? Number(v) : null, expenses))
								}
								value={expenseId ? String(expenseId) : ""}
							/>
							<FieldDescription aria-live="polite" id="tx-expense-hint">
								{expenseHint}
							</FieldDescription>
						</Field>
						<div className="grid grid-cols-2 gap-4">
							<Field>
								<FieldLabel htmlFor="tx-frequency">Frequency</FieldLabel>
								<SelectField
									className="w-full"
									disabled={pending}
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
									disabled={pending}
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
					</FieldSet>
					<DialogFooter>
						<Button
							disabled={pending}
							onClick={onClose}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button loading={pending} type="submit">
							{transaction ? "Save changes" : "Add transaction"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
