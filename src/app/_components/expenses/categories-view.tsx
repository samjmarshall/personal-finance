"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "~/app/_components/page-header";
import { Card } from "~/app/_components/ui/primitives";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { api, type RouterOutputs } from "~/trpc/react";
import { CategoryForm } from "./category-form";

type Category = RouterOutputs["category"]["list"][number];

export function CategoriesView() {
	const [list] = api.category.list.useSuspenseQuery();
	const utils = api.useUtils();
	const remove = api.category.delete.useMutation({
		onSuccess: async () => {
			await utils.category.list.invalidate();
		},
		onError: (err) => alert(err.message),
	});

	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<Category | null>(null);

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
				description="Organise your budgeted expenses into categories."
				title="Expense Categories"
			/>

			<div className="mt-6 flex flex-col gap-3">
				{list.map((category) => (
					<Card
						className="flex items-center justify-between gap-4 p-4"
						key={category.id}
					>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="truncate font-semibold text-foreground text-sm">
									{category.name}
								</span>
								<Badge className="border-border bg-muted text-muted-foreground">
									{category.expenseCount} item
									{category.expenseCount === 1 ? "" : "s"}
								</Badge>
							</div>
							{category.description && (
								<p className="mt-1 truncate text-muted-foreground text-sm">
									{category.description}
								</p>
							)}
						</div>
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
									if (confirm(`Delete "${category.name}"?`))
										remove.mutate({ id: category.id });
								}}
								type="button"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					</Card>
				))}

				{!list.length && (
					<Card className="p-10 text-center">
						<p className="text-muted-foreground text-sm">
							No categories yet. Add your first category to get started.
						</p>
						<Button className="mt-4" onClick={openAdd} size="sm">
							<Plus className="h-4 w-4" />
							Add category
						</Button>
					</Card>
				)}
			</div>

			<CategoryForm
				category={editing}
				key={editing ? `edit-${editing.id}` : "add"}
				onClose={() => setFormOpen(false)}
				open={formOpen}
			/>
		</div>
	);
}
