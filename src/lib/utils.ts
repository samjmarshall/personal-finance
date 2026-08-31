import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const currencyFormatter = new Intl.NumberFormat("en-AU", {
	style: "currency",
	currency: "AUD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-AU", {
	style: "currency",
	currency: "AUD",
	notation: "compact",
	maximumFractionDigits: 1,
});

export function formatCurrency(value: number | null | undefined) {
	return currencyFormatter.format(value ?? 0);
}

export function formatCompact(value: number | null | undefined) {
	return compactFormatter.format(value ?? 0);
}

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
	day: "2-digit",
	month: "short",
	year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("en-AU", {
	month: "short",
	year: "numeric",
});

export function formatDate(value: Date | string | null | undefined) {
	if (!value) return "—";
	const date = typeof value === "string" ? new Date(value) : value;
	return dateFormatter.format(date);
}

// Local-time YYYY-MM-DD for <input type="date">. Must stay local (not UTC) so it
// agrees with the local parse on submit and formatDate's local render — a UTC
// serialise walks the date back a day for users behind UTC.
export function toDateInput(value: Date | string) {
	const date = typeof value === "string" ? new Date(value) : value;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// Inverse of toDateInput: parse a local YYYY-MM-DD to local midnight, or null when
// the string isn't a real calendar date (wrong shape, trailing junk, or a value like
// month 13 / day 32 / a 2-digit year that Date would silently roll into another
// month). Local (not UTC) so the calendar date survives for users behind UTC.
export function fromDateInput(value: string): Date | null {
	const parts = value.split("-");
	if (parts.length !== 3) return null;
	const [year, month, day] = parts.map(Number);
	if (!year || !month || !day) return null;
	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	)
		return null;
	return date;
}

// Compare by local calendar day, not instant: a one-time due today is upcoming,
// not past (adr011 — the date does the work, no archive flag). Local to agree
// with toDateInput/formatDate's local rendering.
export function isPast(date: Date, now: Date): boolean {
	const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return day.getTime() < today.getTime();
}

export function formatMonthKey(key: string) {
	const [year, month] = key.split("-").map(Number);
	if (!year || !month) return key;
	return monthFormatter.format(new Date(year, month - 1, 1));
}
