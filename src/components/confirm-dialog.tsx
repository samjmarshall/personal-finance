"use client";

import type { ReactNode } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

// Prop-taking (not a useConfirm hook) so the owning view keeps the open state
// inline and passes it down — see adr001.
//
// The action is a plain Button, not AlertDialogAction (a Close): the dialog
// must stay open while `pending`, so the caller closes it when the work is done.
export function ConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	pending = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	title: ReactNode;
	description?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	pending?: boolean;
}) {
	return (
		<AlertDialog
			onOpenChange={(next, eventDetails) => {
				if (pending) {
					eventDetails.cancel();
					return;
				}
				onOpenChange(next);
			}}
			open={open}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description && (
						<AlertDialogDescription>{description}</AlertDialogDescription>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>
						{cancelLabel}
					</AlertDialogCancel>
					<Button
						loading={pending}
						onClick={onConfirm}
						variant={destructive ? "destructive" : "default"}
					>
						{confirmLabel}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
