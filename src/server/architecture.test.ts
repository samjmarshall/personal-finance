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
	5: "a non-composition-root imports a shared module instance",
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
	"3 src/app/api/receipts/[id]/image/route.ts → drizzle-orm",
	"3 src/app/api/receipts/[id]/image/route.ts → ~/server/receipts/receipts.schema",
	"5 src/server/outbox/index.ts → ./outbox.module",
];

// Also catches `from "…"` inside comments; a false hit fails loudly, a strict
// parse could miss a real one.
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const RELATIONAL_QUERY = /\.query\.[A-Za-z_$][\w$]*/g;

const lineAt = (source: string, offset: number) =>
	source.slice(0, offset).split("\n").length;

const domainOf = (path: string) => path.match(/^src\/server\/([^/]+)\//)?.[1];

const resolve = (file: string, specifier: string) => {
	let path = specifier;
	if (specifier.startsWith("~/")) path = `src/${specifier.slice(2)}`;
	if (specifier.startsWith(".")) path = join(dirname(file), specifier);
	// `…/db/index` is the same module as `…/db`.
	return path.replace(/\/index$/, "");
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
	if (target.endsWith(".module") && !isCompositionRoot(file)) return 5;
	const isController =
		file.endsWith(".controller.ts") ||
		file.startsWith("src/server/api/routers/");
	if (
		isController &&
		(isSchema || target === "src/server/db" || isDrizzle(specifier))
	) {
		return 3;
	}
	// Pages, layouts and server actions are entry points too. A route may import
	// `db`: it is its own composition root.
	if (file.startsWith("src/app/")) {
		const isDb = target === "src/server/db" && basename(file) !== "route.ts";
		if (isSchema || isDb || isDrizzle(specifier)) return 3;
	}
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

		it("lets only a composition root or module import a module", () => {
			const source =
				'import { c } from "~/server/categories/categories.module";';
			expect(rulesIn("src/server/api/services.ts", source)).toEqual([]);
			expect(
				rulesIn("src/server/transactions/transactions.module.ts", source),
			).toEqual([]);
			expect(
				rulesIn("src/server/receipts/receipt-extraction.service.ts", source),
			).toEqual([5]);
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

		it("flags db in a controller, by folder or index path", () => {
			const file = "src/server/x/x.trpc.controller.ts";
			expect(rulesIn(file, 'import { db } from "~/server/db";')).toEqual([3]);
			expect(rulesIn(file, 'import { db } from "~/server/db/index";')).toEqual([
				3,
			]);
		});

		it("flags data access in any app file, letting only a route import db", () => {
			const db = 'import { db } from "~/server/db";';
			expect(rulesIn("src/app/(dashboard)/x/page.tsx", db)).toEqual([3]);
			expect(rulesIn("src/app/(dashboard)/x/actions.ts", db)).toEqual([3]);
			expect(rulesIn("src/app/api/x/route.ts", db)).toEqual([]);
			expect(
				rulesIn("src/app/api/x/route.ts", 'import { eq } from "drizzle-orm";'),
			).toEqual([3]);
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
