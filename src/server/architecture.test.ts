import { existsSync, globSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// adr022: a domain's tables are reached only through its own service. This reads
// import specifiers, not runtime, so two gaps stay open: raw `sql` naming a foreign
// table, and a table re-exported through a domain `index.ts`.

const RULES = {
	1: "a service or repository imports another domain's schema",
	2: "a non-composition-root imports another domain's repository",
	3: "an entry point does data access",
	4: "the relational db.query API reaches every domain's tables",
} as const;

type Rule = keyof typeof RULES;

interface Violation {
	rule: Rule;
	file: string;
	line: number;
	specifier: string;
}

const COMPOSITION_ROOTS = [
	"src/server/api/services.ts",
	"src/server/inngest/functions.ts",
];

const EXEMPT = [
	// Merges every domain's schema into `db`.
	"src/server/db/index.ts",
	// A system probe with no domain rules: it only runs `select 1`.
	"src/app/api/health/route.ts",
];

// Shrink-only: each migration step deletes the entries it clears.
const TODO = [
	"1 src/server/email/email.repository.ts → ~/server/receipts/receipts.schema",
	"1 src/server/receipts/receipts.repository.ts → ~/server/expenses/categories.schema",
	"1 src/server/transactions/transactions.repository.ts → ~/server/expenses/categories.schema",
	"1 src/server/transactions/transactions.repository.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/allowed-sender.ts → drizzle-orm",
	"3 src/server/api/routers/allowed-sender.ts → ~/server/auth/auth.schema",
	"3 src/server/api/routers/allowed-sender.ts → ~/server/email/allowed-sender.schema",
	"3 src/server/api/routers/balance.ts → drizzle-orm",
	"3 src/server/api/routers/balance.ts → ~/server/balances/balances.schema",
	"3 src/server/api/routers/cashflow.ts → drizzle-orm",
	"3 src/server/api/routers/cashflow.ts → ~/server/balances/balances.schema",
	"3 src/server/api/routers/cashflow.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/cashflow.ts → ~/server/income/income.schema",
	"3 src/server/api/routers/cashflow.ts → ~/server/settings/settings.schema",
	"3 src/server/api/routers/cashflow.ts → ~/server/transactions/transactions.schema",
	"3 src/server/api/routers/category.ts → drizzle-orm",
	"3 src/server/api/routers/category.ts → ~/server/expenses/categories.schema",
	"3 src/server/api/routers/category.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/expense.ts → drizzle-orm",
	"3 src/server/api/routers/expense.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/income.ts → drizzle-orm",
	"3 src/server/api/routers/income.ts → ~/server/income/income.schema",
	"3 src/server/api/routers/receipts.ts → drizzle-orm",
	"3 src/server/api/routers/receipts.ts → ~/server/auth/auth.schema",
	"3 src/server/api/routers/receipts.ts → ~/server/expenses/categories.schema",
	"3 src/server/api/routers/receipts.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/receipts.ts → ~/server/receipts/receipts.schema",
	"3 src/server/api/routers/receipts.ts → ~/server/transactions/transactions.schema",
	"3 src/server/api/routers/setting.ts → drizzle-orm",
	"3 src/server/api/routers/setting.ts → ~/server/settings/settings.schema",
	"3 src/server/api/routers/transaction.ts → drizzle-orm",
	"3 src/server/api/routers/transaction.ts → drizzle-orm/pg-core",
	"3 src/server/api/routers/transaction.ts → ~/server/expenses/categories.schema",
	"3 src/server/api/routers/transaction.ts → ~/server/expenses/expenses.schema",
	"3 src/server/api/routers/transaction.ts → ~/server/transactions/transactions.schema",
	"3 src/app/api/receipts/[id]/image/route.ts → drizzle-orm",
	"3 src/app/api/receipts/[id]/image/route.ts → ~/server/receipts/receipts.schema",
];

// Also catches `from "…"` inside comments; a false hit fails loudly, a strict
// parse could miss a real one.
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const RELATIONAL_QUERY = /\.query\.[A-Za-z_$][\w$]*/g;

const lineAt = (source: string, offset: number) =>
	source.slice(0, offset).split("\n").length;

const domainOf = (path: string) => path.match(/^src\/server\/([^/]+)\//)?.[1];

const resolve = (file: string, specifier: string) => {
	if (specifier.startsWith("~/")) return `src/${specifier.slice(2)}`;
	if (specifier.startsWith(".")) return join(dirname(file), specifier);
	return specifier;
};

const isCompositionRoot = (file: string) =>
	COMPOSITION_ROOTS.includes(file) ||
	file.endsWith(".module.ts") ||
	basename(file) === "route.ts";

const isDrizzle = (specifier: string) =>
	specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/");

function ruleBroken(file: string, specifier: string): Rule | undefined {
	const target = resolve(file, specifier);
	const crossDomain = domainOf(target) !== domainOf(file);
	const isSchema = target.endsWith(".schema");

	if (/\.(service|repository)\.ts$/.test(file) && isSchema && crossDomain) {
		return 1;
	}
	if (
		target.endsWith(".repository") &&
		crossDomain &&
		!isCompositionRoot(file)
	) {
		return 2;
	}
	const isController =
		file.endsWith(".controller.ts") ||
		file.startsWith("src/server/api/routers/");
	if (
		isController &&
		(isSchema || target === "src/server/db" || isDrizzle(specifier))
	) {
		return 3;
	}
	// A route may import `db`: it is its own composition root.
	const isAppRoute =
		file.startsWith("src/app/") && basename(file) === "route.ts";
	if (isAppRoute && (isSchema || isDrizzle(specifier))) return 3;
	return undefined;
}

function violationsIn(file: string, source: string): Violation[] {
	const found: Violation[] = [];
	for (const { 0: text, 1: specifier = "", index } of source.matchAll(
		SPECIFIER,
	)) {
		const rule = ruleBroken(file, specifier);
		if (rule) {
			found.push({
				rule,
				file,
				line: lineAt(source, index + text.length),
				specifier,
			});
		}
	}
	for (const { 0: text, index } of source.matchAll(RELATIONAL_QUERY)) {
		found.push({ rule: 4, file, line: lineAt(source, index), specifier: text });
	}
	return found;
}

const keyOf = (v: Violation) => `${v.rule} ${v.file} → ${v.specifier}`;

// Schema files import each other for foreign keys, which adr022 allows.
const scanned = globSync("src/{server,app}/**/*.{ts,tsx}").filter(
	(file) =>
		!file.endsWith(".test.ts") &&
		!file.endsWith(".schema.ts") &&
		!EXEMPT.includes(file),
);
const violations = scanned.flatMap((file) =>
	violationsIn(file, readFileSync(file, "utf8")),
);

describe("architecture (adr022)", () => {
	it("scans the server and app trees", () => {
		expect(scanned.length).toBeGreaterThan(100);
	});

	it("keeps every exempt path on disk", () => {
		const missing = [...EXEMPT, ...COMPOSITION_ROOTS].filter(
			(path) => !existsSync(path),
		);
		expect(missing).toEqual([]);
	});

	it("finds no violation missing from the to-do list", () => {
		const listed = new Set(TODO);
		const unlisted = violations
			.filter((v) => !listed.has(keyOf(v)))
			.map(
				(v) =>
					`${v.file}:${v.line} breaks rule ${v.rule} (${RULES[v.rule]}): ${v.specifier}`,
			);
		expect(unlisted).toEqual([]);
	});

	it("lists only violations that still occur", () => {
		const live = new Set(violations.map(keyOf));
		const fixed = TODO.filter((entry) => !live.has(entry));
		expect(fixed, "fixed, so delete it from the to-do list").toEqual([]);
	});

	describe("rules", () => {
		const rulesIn = (file: string, source: string) =>
			violationsIn(file, source).map((v) => v.rule);

		it("allows an own-domain schema, flags another domain's", () => {
			const file = "src/server/email/email.repository.ts";
			expect(
				rulesIn(file, 'import { a } from "./allowed-sender.schema";'),
			).toEqual([]);
			expect(
				rulesIn(file, 'import { r } from "~/server/receipts/receipts.schema";'),
			).toEqual([1]);
		});

		it("lets only a composition root import another domain's repository", () => {
			const source = 'import { R } from "~/server/outbox/outbox.repository";';
			expect(rulesIn("src/server/inngest/functions.ts", source)).toEqual([]);
			expect(rulesIn("src/server/email/email.service.ts", source)).toEqual([2]);
		});

		it("flags drizzle-orm/* in a controller, not better-auth's drizzle adapter", () => {
			const file = "src/server/x/x.trpc.controller.ts";
			expect(
				rulesIn(file, 'import type { PgColumn } from "drizzle-orm/pg-core";'),
			).toEqual([3]);
			expect(
				rulesIn(
					file,
					'import { drizzleAdapter } from "better-auth/adapters/drizzle";',
				),
			).toEqual([]);
		});

		it("flags db.query.<table>, not tRPC's .query(", () => {
			expect(
				rulesIn(
					"src/server/x/x.repository.ts",
					"db.query.transactions.findMany()",
				),
			).toEqual([4]);
			expect(
				rulesIn(
					"src/server/x/x.trpc.controller.ts",
					"list: procedure.query(() => [])",
				),
			).toEqual([]);
		});

		it("reads a multi-line dynamic import at the specifier's line", () => {
			const found = violationsIn(
				"src/server/x/x.trpc.controller.ts",
				'const { db } = await import(\n\t"~/server/db"\n);',
			);
			expect(found).toMatchObject([{ rule: 3, line: 2 }]);
		});
	});
});
