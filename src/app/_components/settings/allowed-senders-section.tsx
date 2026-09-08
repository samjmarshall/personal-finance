"use client";

import { Loader2Icon, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "~/app/_components/delete-confirm-dialog";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { allowedSenderCreateDto } from "~/domain/receipts";
import { api, type RouterOutputs } from "~/trpc/react";
import { SettingsSection } from "./settings-section";

type AllowedSender = RouterOutputs["allowedSender"]["list"][number];

export function AllowedSendersSection() {
	const utils = api.useUtils();
	const [senders] = api.allowedSender.list.useSuspenseQuery();
	const [draft, setDraft] = useState("");
	// Client-side validation only. A duplicate address comes back as a CONFLICT and
	// is the global MutationCache's job (src/trpc/query-client.ts) — routing it here
	// too would double-report and mark a well-formed address invalid.
	const [error, setError] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<AllowedSender | null>(null);

	const add = api.allowedSender.add.useMutation({
		onSuccess: async () => {
			setDraft("");
			await utils.allowedSender.list.invalidate();
			toast.success("Address added");
		},
	});

	const remove = api.allowedSender.remove.useMutation({
		onSuccess: async () => {
			await utils.allowedSender.list.invalidate();
			toast.success("Address removed");
		},
	});

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const parsed = allowedSenderCreateDto.safeParse({ email: draft });
		if (!parsed.success) return setError("Please enter a valid email address.");
		add.mutate(parsed.data);
	}

	return (
		<SettingsSection
			description="Receipts are only ingested from these addresses. Mail forwarded from anywhere else is dropped."
			title="Forwarding addresses"
		>
			<form className="mt-5 max-w-sm" onSubmit={onSubmit}>
				<Field>
					<FieldLabel htmlFor="allowed-sender">Add an address</FieldLabel>
					<div className="flex gap-2">
						<Input
							aria-describedby={error ? "allowed-sender-error" : undefined}
							aria-invalid={error ? true : undefined}
							autoComplete="email"
							className="flex-1"
							disabled={add.isPending}
							id="allowed-sender"
							// text, not email: type="email" runs the browser's own constraint
							// check before submit, so its UA tooltip pre-empts FieldError and
							// the wired aria-invalid/role="alert" path never renders. Zod is
							// the validator; inputMode keeps the email keyboard on mobile.
							inputMode="email"
							onChange={(e) => {
								setDraft(e.target.value);
								// Stale error text plus aria-invalid would mislead a screen
								// reader once they start correcting.
								if (error) setError(null);
							}}
							placeholder="you@personal.com"
							type="text"
							value={draft}
						/>
						<Button
							className="w-14"
							disabled={add.isPending || draft.trim() === ""}
							type="submit"
						>
							{add.isPending ? (
								<Loader2Icon
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<Plus className="h-4 w-4" />
							)}
							<span className="sr-only">Add address</span>
						</Button>
					</div>
					<FieldError id="allowed-sender-error">{error}</FieldError>
				</Field>
			</form>

			{senders.length ? (
				<ul className="mt-6 divide-y divide-border rounded-md border border-border">
					{senders.map((sender) => (
						<li
							className="flex items-center justify-between gap-4 px-3 py-2.5"
							key={sender.id}
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-foreground text-sm">
									{sender.email}
								</p>
								{/* Whose receipts these become — the webhook attributes every
								    ingested mail to this Member. */}
								<p className="truncate text-muted-foreground text-xs">
									Files to {sender.userName ?? "an unnamed member"}
								</p>
							</div>
							<button
								aria-label={`Remove ${sender.email}`}
								className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-spend/10 hover:text-spend focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
								onClick={() => {
									setDeleteTarget(sender);
									setConfirmOpen(true);
								}}
								type="button"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-6 rounded-md border border-border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
					No addresses yet. Add the address you forward receipts from.
				</p>
			)}

			<DeleteConfirmDialog
				label={deleteTarget?.email}
				onConfirm={() => {
					if (deleteTarget) remove.mutate({ id: deleteTarget.id });
				}}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
			/>
		</SettingsSection>
	);
}
