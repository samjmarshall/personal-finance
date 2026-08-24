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

export function formatMonthKey(key: string) {
	const [year, month] = key.split("-").map(Number);
	if (!year || !month) return key;
	return monthFormatter.format(new Date(year, month - 1, 1));
}
