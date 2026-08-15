export const PRIORITIES = [
	"Must Have",
	"Should Have",
	"Nice to Have",
	"Fix",
	"VERIFY - possible fraud",
	"n/a",
] as const;

export const FREQUENCIES = ["Recurring", "One-off"] as const;

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
	"Must Have": {
		label: "Must Have",
		badge: "bg-primary/10 text-primary border-primary/20",
		dot: "bg-primary",
	},
	"Should Have": {
		label: "Should Have",
		badge:
			"bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)] border-[color:var(--badge-info-border)]",
		dot: "bg-[var(--badge-info-dot)]",
	},
	"Nice to Have": {
		label: "Nice to Have",
		badge: "bg-muted text-muted-foreground border-border",
		dot: "bg-muted-foreground/50",
	},
	Fix: {
		label: "Fix",
		badge:
			"bg-[var(--badge-warn-bg)] text-[var(--badge-warn-fg)] border-[color:var(--badge-warn-border)]",
		dot: "bg-warning",
	},
	"VERIFY - possible fraud": {
		label: "Verify",
		badge: "bg-spend/10 text-spend border-spend/25",
		dot: "bg-spend",
	},
	"n/a": {
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
