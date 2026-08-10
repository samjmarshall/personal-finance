// Post-publish ticket validator — the skill's hard publish gate.
//
//   yarn tsx .claude/skills/write-tickets/scripts/validate-ticket.ts <n> [--type <t>]
//   yarn tsx .claude/skills/write-tickets/scripts/validate-ticket.ts --epic <P>
//
// Exit codes: 0 = clean (warnings allowed) · 1 = a ticket is non-compliant ·
// 2 = operational failure (gh unavailable / API shape drift / board rename /
// type unresolved). Distinguishing 1 from 2 keeps "fix and re-run until exit 0"
// unambiguous — a gh blip is never read as a compliance pass/fail.
//
// Top-level script (like eval/afca/validate.ts): importing it RUNS it, so the
// unit test imports `rules.ts` only, never this file.

import {
	assertExpectedFields,
	fetchBoard,
	fetchIssue,
	fetchSubIssues,
	GhError,
} from "./gh";
import {
	detectType,
	type NormalizedIssue,
	normalize,
	type TicketType,
	type Violation,
	validateTicket,
} from "./rules";

const TICKET_TYPES: TicketType[] = [
	"story",
	"bug",
	"task",
	"spike",
	"epic",
	"child",
];

interface Args {
	epic?: number;
	issue?: number;
	type?: TicketType;
}

function parseArgs(argv: string[]): Args | { error: string } {
	const args: Args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--epic") {
			const n = Number(argv[++i]);
			if (!Number.isInteger(n))
				return { error: "--epic needs an issue number" };
			args.epic = n;
		} else if (a === "--issue") {
			const n = Number(argv[++i]);
			if (!Number.isInteger(n))
				return { error: "--issue needs an issue number" };
			args.issue = n;
		} else if (a === "--type") {
			const t = argv[++i];
			if (t === undefined || !TICKET_TYPES.includes(t as TicketType))
				return { error: `--type must be one of ${TICKET_TYPES.join("|")}` };
			args.type = t as TicketType;
		} else if (a !== undefined && /^\d+$/.test(a)) {
			args.issue = Number(a);
		} else {
			return { error: `unrecognised argument: ${a}` };
		}
	}
	if (args.epic === undefined && args.issue === undefined)
		return { error: "pass an issue number, or --epic <P>" };
	return args;
}

interface Target {
	issue: NormalizedIssue;
	type: TicketType;
}

function formatReport(targets: Target[], violations: Violation[]): string {
	const byIssue = new Map<number, Violation[]>();
	for (const v of violations) {
		const list = byIssue.get(v.issue) ?? [];
		list.push(v);
		byIssue.set(v.issue, list);
	}
	const lines: string[] = [];
	for (const { issue, type } of targets) {
		const vs = byIssue.get(issue.number) ?? [];
		const errs = vs.filter((v) => v.severity === "ERROR").length;
		const warns = vs.filter((v) => v.severity === "WARN").length;
		const mark = errs > 0 ? "✗" : warns > 0 ? "!" : "✓";
		lines.push(
			`${mark} #${issue.number}  ${type.padEnd(6)}  ${errs} error(s), ${warns} warning(s)  ${issue.title}`,
		);
		for (const v of vs)
			lines.push(
				`    ${v.severity.padEnd(5)} ${v.code.padEnd(22)} ${v.message}`,
			);
	}
	const totalErr = violations.filter((v) => v.severity === "ERROR").length;
	const totalWarn = violations.filter((v) => v.severity === "WARN").length;
	lines.push("");
	lines.push(
		totalErr > 0
			? `FAIL — ${totalErr} error(s), ${totalWarn} warning(s) across ${targets.length} issue(s). Publish gate blocked.`
			: `PASS — 0 errors, ${totalWarn} warning(s) across ${targets.length} issue(s).`,
	);
	return `${lines.join("\n")}\n`;
}

function resolveTargets(args: Args): { targets: Target[]; extra: Violation[] } {
	const board = fetchBoard();
	const targets: Target[] = [];
	const extra: Violation[] = [];

	if (args.epic !== undefined) {
		const epic = normalize(
			fetchIssue(args.epic),
			board.get(args.epic) ?? null,
			fetchSubIssues(args.epic),
		);
		targets.push({ issue: epic, type: "epic" });
		for (const childNum of epic.subIssues) {
			const child = normalize(
				fetchIssue(childNum),
				board.get(childNum) ?? null,
				[],
			);
			targets.push({ issue: child, type: "child" });
			// In epic mode we know the parent — enforce the back-reference points at it.
			if (!new RegExp(`Part of #${args.epic}\\b`).test(child.body))
				extra.push({
					issue: child.number,
					severity: "ERROR",
					code: "WRONG_PART_OF",
					message: `child does not reference its epic ("Part of #${args.epic}")`,
					field: "Part of",
				});
		}
		return { targets, extra };
	}

	// Single issue
	const issueNum = args.issue as number;
	const norm = normalize(fetchIssue(issueNum), board.get(issueNum) ?? null, []);
	const detected = detectType(norm.body, norm.labels);
	const type = args.type ?? detected;
	if (type === null)
		throw new GhError(
			`cannot determine the type of #${issueNum} from its body — pass --type <${TICKET_TYPES.join("|")}>`,
		);
	if (args.type !== undefined && detected !== null && detected !== args.type)
		extra.push({
			issue: norm.number,
			severity: "WARN",
			code: "TYPE_MISMATCH",
			message: `--type ${args.type} but the body looks like a ${detected}`,
			field: "type",
		});
	targets.push({ issue: norm, type });
	return { targets, extra };
}

function run(argv: string[]): number {
	const args = parseArgs(argv);
	if ("error" in args) {
		console.error(`[validate-ticket] ${args.error}`);
		return 2;
	}
	assertExpectedFields(); // rename guard — throws GhError (→ exit 2) if a field is gone
	const { targets, extra } = resolveTargets(args);
	const violations = [
		...extra,
		...targets.flatMap((t) => validateTicket(t.issue, t.type)),
	];
	process.stdout.write(formatReport(targets, violations));
	return violations.some((v) => v.severity === "ERROR") ? 1 : 0;
}

try {
	process.exit(run(process.argv.slice(2)));
} catch (err) {
	if (err instanceof GhError) {
		console.error(`[validate-ticket] ${err.message}`);
		process.exit(2);
	}
	throw err;
}
