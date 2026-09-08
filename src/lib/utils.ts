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

// A bare YYYY-MM-DD (a `date` column, e.g. receiptDate) is a calendar day with no
// zone — `new Date()` reads it as UTC midnight and renders the day *before* for
// anyone behind UTC. Parse those locally, same as toDateInput/isPast; a full
// timestamp still parses as the instant it is.
export function formatDate(value: Date | string | null | undefined) {
	if (!value) return "—";
	const date =
		typeof value === "string"
			? (fromDateInput(value) ?? new Date(value))
			: value;
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

// Intl rejects an unknown IANA zone by throwing, and a zone string can arrive from a
// client — fall back to the runtime's own zone so a bad value degrades rather than 500s.
// Cached because startOfDayInZone runs per row over a scan window.
const zonedDayFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedDayFormatter(timeZone: string): Intl.DateTimeFormat {
	const cached = zonedDayFormatters.get(timeZone);
	if (cached) return cached;
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	};
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
	} catch {
		formatter = new Intl.DateTimeFormat("en-CA", options);
	}
	zonedDayFormatters.set(timeZone, formatter);
	return formatter;
}

// Local midnight of the calendar day `value` lands on *in `timeZone`* (IANA). A
// timestamp is an instant; which day it belongs to depends on who's asking, and the
// runtime's own zone is UTC on the server. Returned at local midnight so it subtracts
// cleanly against fromDateInput's parse of a YYYY-MM-DD calendar column.
export function startOfDayInZone(value: Date, timeZone: string): Date {
	const parts = zonedDayFormatter(timeZone).formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value);
	return new Date(part("year"), part("month") - 1, part("day"));
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

// Callers pass two different things: a `receipt` row's stored value (bare, as the
// producer wrote it) and the blob's HTTP `content-type` header, which Vercel Blob
// hands back verbatim and may parameterise (`text/html; charset=utf-8`). Compare the
// type alone or the header form silently misses every branch.
export function bareMediaType(contentType: string | null | undefined): string {
	return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isPdf(contentType: string | null | undefined): boolean {
	return bareMediaType(contentType) === "application/pdf";
}

// The email Channel stores a forwarded body under one of these (email-ingest.ts).
// Neither is on the image proxy's renderable allowlist, so callers must branch here
// rather than hand the blob to an `<img>` that can only come back as octet-stream.
export function isText(contentType: string | null | undefined): boolean {
	const bare = bareMediaType(contentType);
	return bare === "text/html" || bare === "text/plain";
}
