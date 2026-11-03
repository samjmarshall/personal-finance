import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real `make fix` pipeline on fixed inputs, so a tool bump that breaks a rule fails here.
const root = fileURLToPath(new URL("../..", import.meta.url));

const cases: { name: string; input: string; expected: string }[] = [
	{
		name: "one-line-for-of",
		input: `export function sum(list: number[]) {
	let total = 0;

	for (const n of list) total += n;

	return total;
}
`,
		expected: `export function sum(list: number[]) {
	let total = 0;

	for (const n of list) {
		total += n;
	}

	return total;
}
`,
	},
	{
		name: "while-and-do",
		input: `export function settle(start: number) {
	let n = start;

	while (n) n--;

	do n++; while (n < 3);

	return n;
}
`,
		expected: `export function settle(start: number) {
	let n = start;

	while (n) {
		n--;
	}

	do {
		n++;
	} while (n < 3);

	return n;
}
`,
	},
	{
		name: "else-chain",
		input: `export function pick(a: boolean, b: boolean) {
	if (a) x(); else if (b) y(); else z();
}
`,
		expected: `export function pick(a: boolean, b: boolean) {
	if (a) {
		x();
	} else if (b) {
		y();
	} else {
		z();
	}
}
`,
	},
	{
		name: "braced-if-bare-else-if",
		input: `export function pick(a: boolean, b: boolean) {
	if (a) {
		x();
	} else if (b) y();
}
`,
		expected: `export function pick(a: boolean, b: boolean) {
	if (a) {
		x();
	} else if (b) {
		y();
	}
}
`,
	},
	{
		name: "if-body-on-next-line",
		input: `export function go(ready: boolean) {
	if (ready)
		start();
}
`,
		expected: `export function go(ready: boolean) {
	if (ready) {
		start();
	}
}
`,
	},
	{
		name: "if-long-condition",
		input: `export function go(s: Settings) {
	if (s.autoSync && s.bankConnected && s.lastSyncFailed === false && s.online) startSync();
}
`,
		expected: `export function go(s: Settings) {
	if (s.autoSync && s.bankConnected && s.lastSyncFailed === false && s.online) {
		startSync();
	}
}
`,
	},
	{
		name: "one-line-guard",
		input: `export function show(a: string | null) {
	if (!a) return;

	print(a);
}
`,
		expected: `export function show(a: string | null) {
	if (!a) return;

	print(a);
}
`,
	},
	{
		name: "guard-group",
		input: `export function nextDue(bill: Bill | null) {
	const today = new Date();
	if (!bill) return null;
	if (bill.paid) return null;
	if (bill.due < today) return null;
	return bill.due;
}
`,
		expected: `export function nextDue(bill: Bill | null) {
	const today = new Date();

	if (!bill) return null;
	if (bill.paid) return null;
	if (bill.due < today) return null;

	return bill.due;
}
`,
	},
	{
		name: "one-line-if-beside-braced-if",
		input: `export function route(a: boolean, b: boolean) {
	if (a) return;
	if (b) {
		log(b);
	}
}
`,
		expected: `export function route(a: boolean, b: boolean) {
	if (a) return;

	if (b) {
		log(b);
	}
}
`,
	},
	{
		name: "comment-above-while",
		input: `export function drain(queue: string[]) {
	const seen = new Set<string>();
	// Stop once the queue is empty.
	while (queue.length) {
		seen.add(queue.pop() ?? "");
	}

	return seen;
}
`,
		expected: `export function drain(queue: string[]) {
	const seen = new Set<string>();

	// Stop once the queue is empty.
	while (queue.length) {
		seen.add(queue.pop() ?? "");
	}

	return seen;
}
`,
	},
	{
		name: "template-literal-untouched",
		input: `export function usage() {
	const text = \`Steps:
	log in
return to the menu
	if (done) stop();
\`;

	return text;
}
`,
		expected: `export function usage() {
	const text = \`Steps:
	log in
return to the menu
	if (done) stop();
\`;

	return text;
}
`,
	},
	{
		name: "switch-case-return",
		input: `export function rank(k: string) {
	switch (k) {
		case "a":
			log(k);
			return 1;
		default:
			return 0;
	}
}
`,
		expected: `export function rank(k: string) {
	switch (k) {
		case "a":
			log(k);

			return 1;
		default:
			return 0;
	}
}
`,
	},
	{
		name: "try-then-throw",
		input: `export function load(raw: string) {
	const size = raw.length;
	try {
		parse(raw);
	} catch {
		log(size);
	}
	throw new Error("unreachable");
}
`,
		expected: `export function load(raw: string) {
	const size = raw.length;

	try {
		parse(raw);
	} catch {
		log(size);
	}

	throw new Error("unreachable");
}
`,
	},
	{
		name: "block-edges-untouched",
		input: `export function each(items: string[]) {
	for (const item of items) {
		if (item) {
			log(item);
		}
	}
}
`,
		expected: `export function each(items: string[]) {
	for (const item of items) {
		if (item) {
			log(item);
		}
	}
}
`,
	},
	// Real code shapes from reconcile-synced.ts; rules must handle them as written.
	{
		name: "brief-take",
		input: `export function taker(usedBanks: Set<Bank>, usedCandidates: Set<Txn>) {
	const take = (pair: ScoredPair) => {
		if (usedBanks.has(pair.bank) || usedCandidates.has(pair.candidate))
			return false;
		usedBanks.add(pair.bank);
		usedCandidates.add(pair.candidate);
		return true;
	};

	return take;
}
`,
		expected: `export function taker(usedBanks: Set<Bank>, usedCandidates: Set<Txn>) {
	const take = (pair: ScoredPair) => {
		if (usedBanks.has(pair.bank) || usedCandidates.has(pair.candidate)) {
			return false;
		}

		usedBanks.add(pair.bank);
		usedCandidates.add(pair.candidate);

		return true;
	};

	return take;
}
`,
	},
	{
		name: "brief-long-if-in-loop",
		input: `export function flagClose(close: ScoredPair[], result: Plan) {
	for (const pair of close) {
		if (take(pair))
			result.flag.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				reviewId: null,
				descriptionScore: pair.score.merged,
			});
	}
}
`,
		expected: `export function flagClose(close: ScoredPair[], result: Plan) {
	for (const pair of close) {
		if (take(pair)) {
			result.flag.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				reviewId: null,
				descriptionScore: pair.score.merged,
			});
		}
	}
}
`,
	},
	{
		name: "brief-one-line-for",
		input: `export function finish(unmatched: Bank[], result: Plan) {
	for (const bank of unmatched) if (!usedBanks.has(bank)) result.add.push(bank);
	result.adopt.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	result.flag.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	return result;
}
`,
		expected: `export function finish(unmatched: Bank[], result: Plan) {
	for (const bank of unmatched) {
		if (!usedBanks.has(bank)) result.add.push(bank);
	}

	result.adopt.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	result.flag.sort((x, y) => byId(x.row.externalId, y.row.externalId));

	return result;
}
`,
	},
];

const diagnostics = {
	loop: "Loops need braces.",
	chain: "An if with an else needs braces on every branch.",
	multiline: "Add braces, or fit the whole if on one line.",
	padding: "padding-line-between-statements",
};

function run(bin: string, args: string[]) {
	const { stdout, stderr, status } = spawnSync(
		join(root, "node_modules/.bin", bin),
		args,
		{ encoding: "utf8" },
	);

	return { status: status ?? 1, output: stdout + stderr };
}

const biome = (dir: string, ...flags: string[]) =>
	run("biome", [
		"check",
		...flags,
		`--config-path=${root}`,
		"--vcs-enabled=false",
		"--colors=off",
		dir,
	]);

const oxlint = (dir: string, ...flags: string[]) =>
	run("oxlint", ["-c", join(root, ".oxlintrc.json"), ...flags, dir]);

// Biome lints before it formats, so a long `if` it splits only gets braces on the second pass.
function pipeline(dir: string) {
	biome(dir, "--write");
	biome(dir, "--write");
	oxlint(dir, "--fix");
}

function lint(dir: string) {
	// A high diagnostic cap keeps every message in the output.
	const results = [biome(dir, "--max-diagnostics=500"), oxlint(dir)];

	return {
		statuses: results.map((r) => r.status),
		output: results.map((r) => r.output).join("\n"),
	};
}

async function readAll(dir: string) {
	const entries = await Promise.all(
		cases.map(
			async ({ name }) =>
				[name, await readFile(join(dir, `${name}.ts`), "utf8")] as const,
		),
	);

	return Object.fromEntries(entries);
}

let dir: string;
let lintBefore: ReturnType<typeof lint>;
let lintAfter: ReturnType<typeof lint>;
let fixedOnce: Record<string, string>;
let fixedTwice: Record<string, string>;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "layout-lint-"));
	await Promise.all(
		cases.map(({ name, input }) => writeFile(join(dir, `${name}.ts`), input)),
	);
	lintBefore = lint(dir);
	pipeline(dir);
	fixedOnce = await readAll(dir);
	lintAfter = lint(dir);
	pipeline(dir);
	fixedTwice = await readAll(dir);
}, 30_000);

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("layout lint", () => {
	it.each(cases)("fixes $name", ({ name, expected }) => {
		expect(fixedOnce[name]).toBe(expected);
	});

	it("changes nothing on a second run", () => {
		expect(fixedTwice).toEqual(fixedOnce);
	});

	it("passes the check once fixed", () => {
		expect(lintAfter.statuses, lintAfter.output).toEqual([0, 0]);
	});

	// A rule set to warn still prints its message, so each tool must also exit non-zero.
	it("exits non-zero in both tools before fixing", () => {
		expect(lintBefore.statuses).not.toContain(0);
	});

	it.each(Object.values(diagnostics))(
		"fails the check before fixing: %s",
		(message) => {
			expect(lintBefore.output).toContain(message);
		},
	);
});
