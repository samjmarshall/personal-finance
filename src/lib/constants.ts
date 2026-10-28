export enum Priority {
	MustHave = "Must Have",
	ShouldHave = "Should Have",
	NiceToHave = "Nice to Have",
	Fix = "Fix",
	VerifyPossibleFraud = "VERIFY - possible fraud",
	NA = "n/a",
}

export enum Frequency {
	Recurring = "Recurring",
	OneOff = "One-off",
}

// Expense/Income budget kind. Lowercase, deliberately distinct from a
// Transaction's Frequency: a one-time budget is consumed once against its
// expectedDate; a recurring one keeps the fortnight/month/year Basis figures.
export enum CommitmentKind {
	Recurring = "recurring",
	OneTime = "one-time",
}

// Receipt lifecycle: pending on upload, then the worker flips it to processed,
// duplicate (same photo, no AI spend), or failed (retryable).
export enum ReceiptStatus {
	Pending = "pending",
	Processed = "processed",
	Failed = "failed",
	Duplicate = "duplicate",
}

// How a receipt arrived. Only upload is produced in stage 5; email is defined
// now so stage 6 inbound ingestion adds no migration.
export enum ReceiptChannel {
	Upload = "upload",
	Email = "email",
}

// Which system a Transaction lives in. PayPal is defined now so its sync adds
// no migration.
export enum Provenance {
	Manual = "manual",
	Import = "import",
	Cdr = "cdr",
	Paypal = "paypal",
}

// A RedBark bank connection's consent state, verbatim from its API. Expired,
// invalidated and revoked are terminal: the member re-links in RedBark.
export enum CdrConnectionStatus {
	Pending = "pending",
	Active = "active",
	Expiring = "expiring",
	Expired = "expired",
	Invalidated = "invalidated",
	Revoked = "revoked",
}

// A member-run history import. A queued or running row past a day old is
// treated as dead (see IMPORT_ACTIVE_HOURS), since its job may never report.
export enum CdrImportStatus {
	Queued = "queued",
	Running = "running",
	Done = "done",
	Failed = "failed",
}

// A bank row held for a member's answer. A kept one stays as the record of "Keep
// mine", so the bank row is never asked about or added again.
export enum PossibleDuplicateStatus {
	Pending = "pending",
	Kept = "kept",
}

// One household with AU banks only (CDR is AUD-only), so one fixed zone decides
// which calendar day a row falls on. Becomes a setting with household scoping.
export const HOUSEHOLD_TIME_ZONE = "Australia/Sydney";

// Who recorded a balance snapshot. A label only: the latest asOf wins either way.
export enum BalanceSource {
	Manual = "manual",
	Cdr = "cdr",
}

// Stored frequency/priority are free-text; coerce a read value to the managed
// vocab, falling back to the default when it is outside the current set (e.g.
// legacy/imported data) so a form seed can never hold an unknown value.
export function toFrequency(value: string | null | undefined): Frequency {
	return (Object.values(Frequency) as string[]).includes(value ?? "")
		? (value as Frequency)
		: Frequency.OneOff;
}

export function toCommitmentKind(
	value: string | null | undefined,
): CommitmentKind {
	return (Object.values(CommitmentKind) as string[]).includes(value ?? "")
		? (value as CommitmentKind)
		: CommitmentKind.Recurring;
}

export function toPriority(value: string | null | undefined): Priority {
	return (Object.values(Priority) as string[]).includes(value ?? "")
		? (value as Priority)
		: Priority.NiceToHave;
}

type PriorityStyle = {
	label: string;
	badge: string;
	dot: string;
};

export const PRIORITY_STYLES: Record<string, PriorityStyle> = {
	[Priority.MustHave]: {
		label: "Must Have",
		badge: "bg-primary/10 text-primary border-primary/20",
		dot: "bg-primary",
	},
	[Priority.ShouldHave]: {
		label: "Should Have",
		badge:
			"bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)] border-[color:var(--badge-info-border)]",
		dot: "bg-[var(--badge-info-dot)]",
	},
	[Priority.NiceToHave]: {
		label: "Nice to Have",
		badge: "bg-muted text-muted-foreground border-border",
		dot: "bg-muted-foreground/50",
	},
	[Priority.Fix]: {
		label: "Fix",
		badge:
			"bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)] border-[color:var(--badge-warn-border)]",
		dot: "bg-warning",
	},
	[Priority.VerifyPossibleFraud]: {
		label: "Verify",
		badge:
			"bg-[var(--badge-spend-bg)] text-[var(--badge-spend-fg)] border-[color:var(--badge-spend-border)]",
		dot: "bg-spend",
	},
	[Priority.NA]: {
		label: "Unassigned",
		badge: "bg-muted text-muted-foreground/70 border-border",
		dot: "bg-border",
	},
};

export function priorityStyle(priority: string): PriorityStyle {
	return (
		PRIORITY_STYLES[priority] ?? {
			label: priority,
			badge: "bg-muted text-muted-foreground border-border",
			dot: "bg-muted-foreground/50",
		}
	);
}
