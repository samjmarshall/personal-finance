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

// Stored frequency/priority are free-text; coerce a read value to the managed
// vocab, falling back to the default when it is outside the current set (e.g.
// legacy/imported data) so a form seed can never hold an unknown value.
export function toFrequency(value: string | null | undefined): Frequency {
	return (Object.values(Frequency) as string[]).includes(value ?? "")
		? (value as Frequency)
		: Frequency.OneOff;
}

export function toPriority(value: string | null | undefined): Priority {
	return (Object.values(Priority) as string[]).includes(value ?? "")
		? (value as Priority)
		: Priority.NiceToHave;
}

export const EXPENSE_CATEGORIES = [
	"Home Loan",
	"Bills & Subscriptions",
	"Utilities",
	"Vehicle",
	"Everyday & Personal",
] as const;

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
		badge: "bg-spend/10 text-spend border-spend/25",
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
