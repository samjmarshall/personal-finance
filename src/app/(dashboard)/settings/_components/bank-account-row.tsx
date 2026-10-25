"use client";

import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import {
	accountLabel,
	type CdrSyncState,
	NICKNAME_MAX_LENGTH,
} from "~/domain/cdr";
import { cn } from "~/lib/utils";
import { formatBalance } from "./bank-accounts.display";

export type BankAccountRowProps = {
	account: Pick<
		CdrSyncState,
		| "accountId"
		| "accountName"
		| "accountNumber"
		| "balance"
		| "inBalance"
		| "nickname"
	>;
	onInBalanceChange: (inBalance: boolean) => void;
	/** The box's text as typed. Blank clears the nickname. */
	onRename: (nickname: string) => void;
};

export function BankAccountRow({
	account,
	onInBalanceChange,
	onRename,
}: BankAccountRowProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const labelId = useId();
	const numberId = useId();
	const hintId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const pencilRef = useRef<HTMLButtonElement>(null);
	const switchRef = useRef<HTMLButtonElement>(null);
	// Set on close only, so the first render doesn't steal focus.
	const refocusPencil = useRef(false);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		} else if (refocusPencil.current) {
			refocusPencil.current = false;
			pencilRef.current?.focus();
		}
	}, [editing]);

	const label = accountLabel(account);
	// Two accounts can share a bank's name; the number tells them apart.
	const name = [label, account.accountNumber].filter(Boolean).join(" ");
	const undecided = account.inBalance === null;

	function open() {
		setDraft(account.nickname ?? "");
		setEditing(true);
	}
	function close() {
		refocusPencil.current = true;
		setEditing(false);
	}

	return (
		<li
			className={cn(
				"flex items-center gap-3 px-3 py-2.5",
				undecided && "border-l-2 border-l-warning pl-2.5",
			)}
		>
			<div className="min-w-0 flex-1">
				{editing ? (
					<form
						className="flex flex-wrap items-center gap-2"
						// On the form, so Escape works from Save and Cancel too.
						onKeyDown={(event) => {
							if (event.key !== "Escape") return;
							event.preventDefault();
							close();
						}}
						onSubmit={(event) => {
							event.preventDefault();
							onRename(draft);
							close();
						}}
					>
						<Input
							aria-label={`New name for ${name}`}
							className="h-7 sm:w-56"
							maxLength={NICKNAME_MAX_LENGTH}
							onChange={(event) => setDraft(event.target.value)}
							placeholder={account.accountName ?? undefined}
							ref={inputRef}
							value={draft}
						/>
						<Button size="xs" type="submit">
							Save
						</Button>
						<Button onClick={close} size="xs" type="button" variant="ghost">
							Cancel
						</Button>
					</form>
				) : (
					<p className="wrap-anywhere font-medium text-foreground text-sm">
						<span id={labelId}>{label}</span>
						<button
							aria-label={`Rename ${name}`}
							// The pseudo-element grows the tap target past the small icon.
							className="relative ml-1 inline-flex rounded p-0.5 align-middle text-muted-foreground after:absolute after:-inset-1.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
							onClick={open}
							ref={pencilRef}
							type="button"
						>
							<Pencil aria-hidden="true" className="size-3.5" />
						</button>
					</p>
				)}
				<p className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
					{account.accountNumber && (
						<span className="font-mono" id={numberId}>
							{account.accountNumber}
						</span>
					)}
					{account.nickname && account.accountName && (
						<span>{account.accountName}</span>
					)}
					{undecided && (
						<span
							className="font-medium text-[var(--badge-warn-fg)]"
							id={hintId}
						>
							New — switch on if it's cash, or{" "}
							<button
								aria-describedby={`${labelId} ${numberId}`}
								className="rounded underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
								onClick={() => {
									// The hint and this button go once it's saved.
									switchRef.current?.focus();
									onInBalanceChange(false);
								}}
								type="button"
							>
								leave it out
							</button>
						</span>
					)}
				</p>
			</div>
			{/* Only the balance greys: a switched-off account still syncs. */}
			<p
				className={cn(
					"shrink-0 whitespace-nowrap text-sm tabular-nums",
					account.inBalance ? "text-foreground" : "text-muted-foreground",
					account.inBalance === false && "line-through",
				)}
			>
				{account.balance === null ? (
					<>
						<span aria-hidden="true">—</span>
						<span className="sr-only">No balance yet</span>
					</>
				) : (
					formatBalance(account.balance)
				)}
			</p>
			<Switch
				// Else undecided reads as the same "off" as a decided row.
				aria-describedby={undecided ? hintId : undefined}
				aria-label={`Count ${name} in cash balance`}
				checked={account.inBalance === true}
				onCheckedChange={(checked) => onInBalanceChange(checked)}
				ref={switchRef}
			/>
		</li>
	);
}
