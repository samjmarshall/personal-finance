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
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldOptional,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { api, type RouterOutputs } from "~/trpc/react";

type Category = RouterOutputs["category"]["list"][number];

export function CategoryForm({
	open,
	onClose,
	category,
}: {
	open: boolean;
	onClose: () => void;
	category: Category | null;
}) {
	const utils = api.useUtils();
	const [name, setName] = useState(category?.name ?? "");
	const [description, setDescription] = useState(category?.description ?? "");
	const [sortOrder, setSortOrder] = useState(
		category ? String(category.sortOrder) : "0",
	);
	const [error, setError] = useState<string | null>(null);

	const onSuccess = async () => {
		await utils.category.list.invalidate();
		await utils.expense.list.invalidate();
		onClose();
	};
	// Server/mutation failures surface via the global MutationCache toast
	// (query-client.ts); `error` here is client-side validation only.
	const create = api.category.create.useMutation({ onSuccess });
	const update = api.category.update.useMutation({ onSuccess });
	const isSaving = create.isPending || update.isPending;

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		if (!name.trim()) return setError("Please enter a name.");

		const payload = {
			name: name.trim(),
			description: description.trim() || undefined,
			sortOrder: Number.parseInt(sortOrder, 10) || 0,
		};

		if (category) update.mutate({ id: category.id, ...payload });
		else create.mutate(payload);
	}

	return (
		<Dialog onOpenChange={(next) => !next && onClose()} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{category ? "Edit category" : "Add category"}
					</DialogTitle>
					<DialogDescription>
						Categories group your budgeted expenses.
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={onSubmit}>
					<Field>
						<FieldLabel htmlFor="cat-name">Name</FieldLabel>
						<Input
							id="cat-name"
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Utilities"
							value={name}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="cat-desc">
							Description
							<FieldOptional />
						</FieldLabel>
						<Textarea
							id="cat-desc"
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What belongs in this category?"
							value={description}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="cat-sort">Sort order</FieldLabel>
						<Input
							aria-describedby="cat-sort-hint"
							id="cat-sort"
							inputMode="numeric"
							onChange={(e) => setSortOrder(e.target.value)}
							placeholder="0"
							step="1"
							type="number"
							value={sortOrder}
						/>
						<FieldDescription id="cat-sort-hint">
							Lower numbers appear first.
						</FieldDescription>
					</Field>

					{error && (
						<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend">
							{error}
						</p>
					)}

					<DialogFooter>
						<Button onClick={onClose} type="button" variant="outline">
							Cancel
						</Button>
						<Button disabled={isSaving} type="submit">
							{isSaving
								? "Saving…"
								: category
									? "Save changes"
									: "Add category"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
