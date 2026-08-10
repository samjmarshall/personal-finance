import { readFileSync } from "node:fs";
import postgres from "postgres";
import { read, utils } from "xlsx";

// Load the env file directly rather than via `source` — values containing `&`
// break shell sourcing. Same approach drizzle-kit takes.
if (!process.env.DATABASE_URL) process.loadEnvFile();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const buf = readFileSync("docs/budget.xlsx");
const wb = read(buf, { cellDates: true });

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v) => (v == null || v === "" ? null : String(v).trim());

// ---------- Expenses ----------
// 5 column-blocks of width 5: [name, fortnight, month, year, spacer]
const EXPENSE_CATEGORIES = [
	"Everyday & Personal",
	"Home Loan",
	"Bills & Subscriptions",
	"Utilities",
	"Vehicle",
];
const SKIP_NAMES = new Set([
	"Total Expenses",
	"Expense Total",
	"Income Total",
	"Savings Total",
]);

const expenseRows = utils.sheet_to_json(wb.Sheets.Expenses, {
	header: 1,
	defval: null,
	blankrows: false,
});

// createdAt is a drizzle `$defaultFn`, i.e. ORM-side only — these raw inserts
// bypass it and the column is NOT NULL, so set it explicitly.
const createdAt = new Date();

const expenses = [];
let expOrder = 0;
for (let b = 0; b < EXPENSE_CATEGORIES.length; b++) {
	const base = b * 5;
	for (let r = 1; r < expenseRows.length; r++) {
		const row = expenseRows[r];
		const name = str(row[base]);
		if (!name || SKIP_NAMES.has(name)) continue;
		expenses.push({
			name,
			category: EXPENSE_CATEGORIES[b],
			fortnight: num(row[base + 1]),
			month: num(row[base + 2]),
			year: num(row[base + 3]),
			sortOrder: expOrder++,
			createdAt,
		});
	}
}

// ---------- Income ----------
// 2 column-blocks of width 5. Row0 = person label, Row1 = header, then data.
const incomeRows = utils.sheet_to_json(wb.Sheets.Income, {
	header: 1,
	defval: null,
	blankrows: false,
});
const income = [];
let incOrder = 0;
for (let b = 0; b < 2; b++) {
	const base = b * 5;
	const person = str(incomeRows[0]?.[base]) ?? (b === 0 ? "Sam" : "Tess");
	for (let r = 2; r < incomeRows.length; r++) {
		const row = incomeRows[r];
		const source = str(row[base]);
		if (!source || source === "Total") continue;
		income.push({
			person,
			source,
			fortnight: num(row[base + 1]),
			month: num(row[base + 2]),
			year: num(row[base + 3]),
			sortOrder: incOrder++,
			createdAt,
		});
	}
}

// ---------- Transactions ----------
const txRows = utils.sheet_to_json(wb.Sheets["Transaction History"], {
	header: 1,
	defval: null,
	blankrows: false,
});
const transactions = [];
for (let r = 1; r < txRows.length; r++) {
	const row = txRows[r];
	const rawDate = row[0];
	if (!rawDate) continue;
	const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
	if (Number.isNaN(date.getTime())) continue;
	transactions.push({
		date,
		description: str(row[1]) ?? "(no description)",
		receiptDescription: str(row[2]),
		amount: num(row[3]),
		category: str(row[4]) ?? "Uncategorised",
		frequency: str(row[5]) ?? "One-off",
		priority: str(row[6]) ?? "Nice to Have",
		notes: str(row[7]),
		createdAt,
	});
}

console.log(
	`Parsed: ${expenses.length} expenses, ${income.length} income, ${transactions.length} transactions`,
);

await sql`DELETE FROM ${sql("expense")}`;
await sql`DELETE FROM ${sql("income")}`;
await sql`DELETE FROM ${sql("transaction")}`;

if (expenses.length) await sql`INSERT INTO ${sql("expense")} ${sql(expenses)}`;
if (income.length) await sql`INSERT INTO ${sql("income")} ${sql(income)}`;

// insert transactions in chunks
for (let i = 0; i < transactions.length; i += 200) {
	const chunk = transactions.slice(i, i + 200);
	await sql`INSERT INTO ${sql("transaction")} ${sql(chunk)}`;
}

const [{ count: ec }] = await sql`SELECT count(*)::int FROM ${sql("expense")}`;
const [{ count: ic }] = await sql`SELECT count(*)::int FROM ${sql("income")}`;
const [{ count: tc }] =
	await sql`SELECT count(*)::int FROM ${sql("transaction")}`;
console.log(
	`Seeded rows -> expenses: ${ec}, income: ${ic}, transactions: ${tc}`,
);

await sql.end();
