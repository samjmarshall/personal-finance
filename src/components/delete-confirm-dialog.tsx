"use client";

import { ConfirmDialog } from "~/components/confirm-dialog";

// Delete-specific wrapper over ConfirmDialog: the fixed copy and destructive
// styling live here once, so every list view shares one consistent delete
// prompt. Prop-taking; see adr001.
export function DeleteConfirmDialog({
	open,
	onOpenChange,
	label,
	onConfirm,
	pending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// The row's display name; the title reads `Delete "<label>"?`.
	label: string | undefined;
	onConfirm: () => void;
	pending?: boolean;
}) {
	return (
		<ConfirmDialog
			confirmLabel="Delete"
			description="This can't be undone."
			destructive
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			pending={pending}
			title={label ? `Delete "${label}"?` : ""}
		/>
	);
}
