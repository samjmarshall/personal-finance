import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { read, utils } from "xlsx";

import { db } from "~/server/db";
import { expenses, income, transactions } from "~/server/db/schema";

export const dynamic = "force-dynamic";

const num = (v: unknown) =>
	typeof v === "number" && Number.isFinite(v) ? v : 0;
const str = (v: unknown) =>
	v == null || v === "" ? null : String(v).trim();

export async function GET() {
	const buf = readFileSync(path.join(process.cwd(), "docs/budget.xlsx"));
	const wb = read(buf, { cellDates: true });

	// ---------- Expenses ----------
	const EXPENSE_CATEGORIES = [
		"Everyday & Personal",
		"Home Loan",
		"Bills & Subscriptions",
		"Utilities",
		"Vehicle",
	];
	const SKIP = new Set([
		"Total Expenses",
		"Expense Total",
		"Income Total",
		"Savings Total",
	]);
	const eRows = utils.sheet_to_json<unknown[]>(wb.Sheets.Expenses!, {
		header: 1,
		defval: null,
		blankrows: false,
	});
	const expenseValues: (typeof expenses.$inferInsert)[] = [];
	let eOrder = 0;
	for (let b = 0; b < EXPENSE_CATEGORIES.length; b++) {
		const base = b * 5;
		for (let r = 1; r < eRows.length; r++) {
			const row = eRows[r]!;
			const name = str(row[base]);
			if (!name || SKIP.has(name)) continue;
			expenseValues.push({
				name,
				category: EXPENSE_CATEGORIES[b]!,
				fortnight: num(row[base + 1]),
				month: num(row[base + 2]),
				year: num(row[base + 3]),
				sortOrder: eOrder++,
			});
		}
	}

	// ---------- Income ----------
	const iRows = utils.sheet_to_json<unknown[]>(wb.Sheets.Income!, {
		header: 1,
		defval: null,
		blankrows: false,
	});
	const incomeValues: (typeof income.$inferInsert)[] = [];
	let iOrder = 0;
	for (let b = 0; b < 2; b++) {
		const base = b * 5;
		const person = str(iRows[0]?.[base]) ?? (b === 0 ? "Sam" : "Tess");
		for (let r = 2; r < iRows.length; r++) {
			const row = iRows[r]!;
			const source = str(row[base]);
			if (!source || source === "Total") continue;
			incomeValues.push({
				person,
				source,
				fortnight: num(row[base + 1]),
				month: num(row[base + 2]),
				year: num(row[base + 3]),
				sortOrder: iOrder++,
			});
		}
	}

	// ---------- Transactions ----------
	const tRows = utils.sheet_to_json<unknown[]>(
		wb.Sheets["Transaction History"]!,
		{ header: 1, defval: null, blankrows: false },
	);
	const txValues: (typeof transactions.$inferInsert)[] = [];
	for (let r = 1; r < tRows.length; r++) {
		const row = tRows[r]!;
		const raw = row[0];
		if (!raw) continue;
		const date = raw instanceof Date ? raw : new Date(String(raw));
		if (Number.isNaN(date.getTime())) continue;
		txValues.push({
			date,
			description: str(row[1]) ?? "(no description)",
			receiptDescription: str(row[2]),
			amount: num(row[3]),
			category: str(row[4]) ?? "Uncategorised",
			frequency: str(row[5]) ?? "One-off",
			priority: str(row[6]) ?? "Nice to Have",
			notes: str(row[7]),
		});
	}

	await db.delete(expenses);
	await db.delete(income);
	await db.delete(transactions);

	if (expenseValues.length) await db.insert(expenses).values(expenseValues);
	if (incomeValues.length) await db.insert(income).values(incomeValues);
	for (let i = 0; i < txValues.length; i += 200) {
		await db.insert(transactions).values(txValues.slice(i, i + 200));
	}

	return NextResponse.json({
		expenses: expenseValues.length,
		income: incomeValues.length,
		transactions: txValues.length,
	});
}
