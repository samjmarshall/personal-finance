"use client";

import { GripVerticalIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "~/components/delete-confirm-dialog";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	Sortable,
	SortableItem,
	SortableItemHandle,
} from "~/components/ui/sortable";
import { api, type RouterOutputs } from "~/trpc/react";
import { CategoryForm } from "./category-form";

type Category = RouterOutputs["category"]["list"][number];

export function CategoriesView() {
	const [categories] = api.category.list.useSuspenseQuery();
	const [counts] = api.expense.countsByCategory.useSuspenseQuery();
	const countOf = new Map(counts.map((row) => [row.categoryId, row.count]));
	const utils = api.useUtils();
	const remove = api.category.delete.useMutation({
		onSuccess: async () => {
			await Promise.all([
				utils.category.list.invalidate(),
				utils.expense.countsByCategory.invalidate(),
			]);
		},
	});
	const reorder = api.category.reorder.useMutation({
		onSuccess: async () => {
			await utils.category.list.invalidate();
			toast.success("Category order saved");
		},
		onError: async () => {
			// Refetch the saved order to undo the optimistic move; the global toast shows the error.
			await utils.category.list.invalidate();
		},
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Category | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

	const handleSortOrderChange = (next: Category[]) => {
		utils.category.list.setData(undefined, next); // optimistic
		reorder.mutate({ ids: next.map((category) => category.id) });
	};

	const getItemValue = (category: Category) => String(category.id);

	function openAdd() {
		setEditing(null);
		setFormOpen(true);
	}
	function openEdit(category: Category) {
		setEditing(category);
		setFormOpen(true);
	}

	return (
		<div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Button onClick={openAdd} size="sm">
						<Plus className="h-4 w-4" />
						Add category
					</Button>
				}
				description="File Expenses, Transactions and receipt items under one shared list."
				title="Categories"
			/>

			<div className="mt-6 flex flex-col gap-3">
				<Sortable
					className="space-y-2"
					getItemValue={getItemValue}
					onValueChange={handleSortOrderChange}
					strategy="vertical"
					value={categories}
				>
					{categories.map((category) => {
						const expenseCount = countOf.get(category.id) ?? 0;
						return (
							<SortableItem key={category.id} value={String(category.id)}>
								<Card>
									<CardContent className="flex items-center justify-between gap-4">
										<SortableItemHandle className="text-muted-foreground hover:text-foreground">
											<GripVerticalIcon className="size-4" />
										</SortableItemHandle>
										<div className="flex flex-1 items-center gap-2">
											<span className="truncate font-semibold text-foreground text-sm">
												{category.name}
											</span>
											<Badge className="border-border bg-muted text-muted-foreground">
												{expenseCount} item
												{expenseCount === 1 ? "" : "s"}
											</Badge>
										</div>
										{category.description && (
											<p className="mt-1 truncate text-muted-foreground text-sm">
												{category.description}
											</p>
										)}
										<div className="flex shrink-0 gap-0.5">
											<button
												aria-label={`Edit ${category.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
												onClick={() => openEdit(category)}
												type="button"
											>
												<Pencil className="h-4 w-4" />
											</button>
											<button
												aria-label={`Delete ${category.name}`}
												className="rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend"
												onClick={() => {
													setDeleteTarget(category);
													setConfirmOpen(true);
												}}
												type="button"
											>
												<Trash2 className="h-4 w-4" />
											</button>
										</div>
									</CardContent>
								</Card>
							</SortableItem>
						);
					})}
				</Sortable>

				{!categories.length && (
					<Card className="text-center [--card-spacing:--spacing(10)]">
						<CardContent>
							<p className="text-muted-foreground text-sm">
								No categories yet. Add your first category to get started.
							</p>
							<Button className="mt-4" onClick={openAdd} size="sm">
								<Plus className="h-4 w-4" />
								Add category
							</Button>
						</CardContent>
					</Card>
				)}
			</div>

			<CategoryForm
				category={editing}
				key={editing ? `edit-${editing.id}` : "add"}
				onClose={() => setFormOpen(false)}
				open={formOpen}
			/>

			<DeleteConfirmDialog
				label={deleteTarget?.name}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</div>
	);
}
