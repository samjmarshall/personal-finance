"use client";

import { ConfirmDialog } from "~/app/_components/confirm-dialog";

// Delete-specific wrapper over ConfirmDialog: the fixed copy and destructive
// styling live here once, so the list views share one source of truth for how a
// delete prompt reads. Prop-taking, not a hook — the owning view keeps the
// open/target state and passes it down (adr001).
export function DeleteConfirmDialog({
	open,
	onOpenChange,
	label,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// The row's display name; the title reads `Delete "<label>"?`.
	label: string | undefined;
	onConfirm: () => void;
}) {
	return (
		<ConfirmDialog
			confirmLabel="Delete"
			description="This can't be undone."
			destructive
			onConfirm={onConfirm}
			onOpenChange={onOpenChange}
			open={open}
			title={label ? `Delete "${label}"?` : ""}
		/>
	);
}
