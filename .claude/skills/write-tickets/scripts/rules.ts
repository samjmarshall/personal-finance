// Pure, testable core of the ticket validator.
//
// No I/O lives here — every function takes plain data and returns plain data, so
// the whole rule set is exercised by `rules.test.ts` against captured fixtures
// with no network. The I/O shell (`gh` calls, process exit) lives in
// `validate-ticket.ts`; this split mirrors `eval/afca` (pure `schema.ts`/`mapping.ts`
// vs the I/O `validate.ts`).

import { z } from "zod";

// ── Boundary schemas — parse `gh` output, never trust it ─────────────────────
//
// `gh project item-list --format json` keys field values by their lowercase,
// space-containing display NAME ("start date", not "startDate"). Unset fields are
// ABSENT, not null — hence `.nullish()` (accepts missing or null) throughout.

export const RawIssueSchema = z.object({
	number: z.number(),
	title: z.string(),
	body: z.string(),
	url: z.string(),
	labels: z.array(z.object({ name: z.string() })).default([]),
	milestone: z
		.object({ title: z.string(), dueOn: z.string().nullish() })
		.nullish(),
});
export type RawIssue = z.infer<typeof RawIssueSchema>;

export const RawProjectItemSchema = z.object({
	id: z.string(),
	content: z.object({
		number: z.number(),
		title: z.string().default(""),
		body: z.string().default(""),
		url: z.string().default(""),
	}),
	status: z.string().nullish(),
	milestone: z
		.object({ title: z.string(), dueOn: z.string().nullish() })
		.nullish(),
	team: z.string().nullish(),
	"start date": z.string().nullish(),
	"target date": z.string().nullish(),
});
export type RawProjectItem = z.infer<typeof RawProjectItemSchema>;

export const RawBoardSchema = z.object({
	items: z.array(RawProjectItemSchema),
	totalCount: z.number(),
});
export type RawBoard = z.infer<typeof RawBoardSchema>;

// ── Normalized shape — the contract between fetch and validate ───────────────

export interface Milestone {
	title: string;
	dueOn: string | null; // date-only (YYYY-MM-DD); GitHub returns a timestamp
}

export interface ProjectFields {
	status: string | null;
	startDate: string | null;
	targetDate: string | null;
	milestone: Milestone | null;
	team: string | null;
}

export interface NormalizedIssue {
	number: number;
	title: string;
	body: string;
	url: string;
	labels: string[];
	milestone: Milestone | null;
	project: ProjectFields | null; // null = issue is NOT on the board
	subIssues: number[];
}

const dateOnly = (s: string | null | undefined): string | null =>
	s == null || s === "" ? null : s.slice(0, 10);

const normMilestone = (
	m: { title: string; dueOn?: string | null } | null | undefined,
): Milestone | null =>
	m == null ? null : { title: m.title, dueOn: dateOnly(m.dueOn) };

/** Map the two raw `gh` shapes (+ sub-issue numbers) into one flat record. PURE. */
export function normalize(
	issue: RawIssue,
	item: RawProjectItem | null,
	subIssues: number[],
): NormalizedIssue {
	return {
		number: issue.number,
		title: issue.title,
		body: issue.body.replace(/\r\n/g, "\n"), // CRLF → LF before any heading scan
		url: issue.url,
		labels: issue.labels.map((l) => l.name),
		milestone: normMilestone(issue.milestone),
		project:
			item == null
				? null
				: {
						status: item.status ?? null,
						startDate: item["start date"] ?? null,
						targetDate: item["target date"] ?? null,
						milestone: normMilestone(item.milestone),
						team: item.team ?? null,
					},
		subIssues,
	};
}

// ── Markdown structure predicates ────────────────────────────────────────────

const HEADING_RE = /^#{2,3}\s+(.+?)\s*$/;

const normalizeHeading = (s: string): string =>
	s
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/\s*\(optional\)\s*$/, "");

/** Set of normalized H2/H3 heading texts present in the body. */
export function parseHeadings(body: string): Set<string> {
	const set = new Set<string>();
	for (const line of body.split("\n")) {
		const text = HEADING_RE.exec(line)?.[1];
		if (text !== undefined) set.add(normalizeHeading(text));
	}
	return set;
}

export const headingPresent = (headings: Set<string>, name: string): boolean =>
	headings.has(normalizeHeading(name));

/** Count `- [ ]` / `- [x]` items scoped to the section under any of `acHeadings`. */
export function checkboxCountUnder(body: string, acHeadings: string[]): number {
	const targets = new Set(acHeadings.map(normalizeHeading));
	let inSection = false;
	let count = 0;
	for (const line of body.split("\n")) {
		const text = HEADING_RE.exec(line)?.[1];
		if (text !== undefined) {
			inSection = targets.has(normalizeHeading(text));
			continue;
		}
		if (inSection && /^\s*-\s+\[[ xX]\]\s+\S/.test(line)) count++;
	}
	return count;
}

export const WEAK_AC_PHRASES = [
	"works properly",
	"looks good",
	"no bugs",
	"performs well",
	"users are happy",
];

/** Banned weak phrases appearing inside the AC section (lexical, WARN-level). */
export function weakPhrasesInAc(body: string, acHeadings: string[]): string[] {
	const targets = new Set(acHeadings.map(normalizeHeading));
	const found = new Set<string>();
	let inSection = false;
	for (const line of body.split("\n")) {
		const text = HEADING_RE.exec(line)?.[1];
		if (text !== undefined) {
			inSection = targets.has(normalizeHeading(text));
			continue;
		}
		if (inSection) {
			const lower = line.toLowerCase();
			for (const p of WEAK_AC_PHRASES) if (lower.includes(p)) found.add(p);
		}
	}
	return [...found];
}

export interface WorkReadiness {
	present: boolean;
	type: "AFK" | "HITL" | null;
	hasReason: boolean;
}

/** Parse the `**Work-readiness:** AFK|HITL [— reason]` tag. */
export function parseWorkReadiness(body: string): WorkReadiness {
	const m =
		/^\*\*Work-readiness:\*\*\s+(AFK|HITL)\b[ \t]*([—–-][ \t]*\S.*)?$/m.exec(
			body,
		);
	if (!m) return { present: false, type: null, hasReason: false };
	return {
		present: true,
		type: m[1] as "AFK" | "HITL",
		hasReason: m[2] != null && m[2].replace(/^[—–-]\s*/, "").trim().length > 0,
	};
}

export const hasPartOf = (body: string): boolean =>
	/(^|\n)\s*Part of #\d+/.test(body);

export const partOfNumbers = (body: string): number[] =>
	[...body.matchAll(/Part of #(\d+)/g)].map((m) => Number(m[1]));

// ── Per-type spec table — the single source of truth ─────────────────────────

export type TicketType = "story" | "bug" | "task" | "spike" | "epic" | "child";
export type Severity = "ERROR" | "WARN";

export interface Violation {
	issue: number;
	severity: Severity;
	code: string;
	message: string;
	field?: string;
}

interface HeadingReq {
	label: string; // canonical display label (used in messages)
	code: string; // violation code if absent
	anyOf: string[]; // satisfied if ANY spelling is present
}

interface TicketSpec {
	headings: HeadingReq[];
	acHeadings: string[] | null; // null = no AC section required (epics)
	requireWorkReadiness: boolean;
	requireCurrentDesired: boolean; // child: combined heading OR both split halves
	requirePartOf: boolean;
	minSubIssues: number;
	visualEvidenceForUiBug: boolean; // bug: WARN if absent
}

const h = (label: string, code: string, ...anyOf: string[]): HeadingReq => ({
	label,
	code,
	anyOf: anyOf.length > 0 ? anyOf : [label],
});

const AC = ["Acceptance Criteria"]; // case-folded match also covers "Acceptance criteria"

export const TICKET_SPECS: Record<TicketType, TicketSpec> = {
	story: {
		headings: [h("Story", "MISSING_STORY"), h("Context", "MISSING_CONTEXT")],
		acHeadings: AC,
		requireWorkReadiness: true,
		requireCurrentDesired: false,
		requirePartOf: false,
		minSubIssues: 0,
		visualEvidenceForUiBug: false,
	},
	bug: {
		headings: [
			h("Impact Assessment", "MISSING_IMPACT"),
			h("Description", "MISSING_DESCRIPTION"),
			h("Steps to Reproduce", "MISSING_REPRO"),
			h("Environment", "MISSING_ENVIRONMENT"),
		],
		acHeadings: AC,
		requireWorkReadiness: true,
		requireCurrentDesired: false,
		requirePartOf: false,
		minSubIssues: 0,
		visualEvidenceForUiBug: true,
	},
	task: {
		headings: [
			h("Purpose", "MISSING_PURPOSE"),
			h("Context", "MISSING_CONTEXT"),
			h("Technical Approach", "MISSING_APPROACH"),
			h("Dependencies", "MISSING_DEPENDENCIES"),
		],
		acHeadings: AC,
		requireWorkReadiness: true,
		requireCurrentDesired: false,
		requirePartOf: false,
		minSubIssues: 0,
		visualEvidenceForUiBug: false,
	},
	spike: {
		headings: [
			h("Research Question", "MISSING_RESEARCH_QUESTION"),
			h("Goals/Questions to Answer", "MISSING_GOALS"),
			h("Deliverable", "MISSING_DELIVERABLE"),
			h("Time Box", "MISSING_TIMEBOX"),
			h("Follow-up Actions", "MISSING_FOLLOWUP"),
		],
		acHeadings: AC,
		requireWorkReadiness: true,
		requireCurrentDesired: false,
		requirePartOf: false,
		minSubIssues: 0,
		visualEvidenceForUiBug: false,
	},
	epic: {
		headings: [
			h("Goal", "MISSING_GOAL"),
			h("Business Context", "MISSING_BUSINESS_CONTEXT"),
			h("Scope", "MISSING_SCOPE"),
			h("Key Deliverables", "MISSING_DELIVERABLES"),
			h("Dependencies", "MISSING_DEPENDENCIES"),
			h("Risks and Mitigations", "MISSING_RISKS"),
		],
		acHeadings: null, // epics are containers — no AC, no work-readiness tag
		requireWorkReadiness: false,
		requireCurrentDesired: false,
		requirePartOf: false,
		minSubIssues: 1,
		visualEvidenceForUiBug: false,
	},
	child: {
		headings: [
			h("Purpose", "MISSING_PURPOSE"),
			h("Out of scope", "MISSING_OUT_OF_SCOPE"),
			h("References", "MISSING_REFERENCES"),
		],
		acHeadings: ["Acceptance criteria"],
		requireWorkReadiness: true,
		requireCurrentDesired: true,
		requirePartOf: true,
		minSubIssues: 0,
		visualEvidenceForUiBug: false,
	},
};

// ── Type detection (priority-ordered; used as cross-check + fallback) ─────────

export function detectType(body: string, labels: string[]): TicketType | null {
	const hs = parseHeadings(body);
	if (
		labels.includes("epic") ||
		(headingPresent(hs, "Goal") &&
			headingPresent(hs, "Business Context") &&
			headingPresent(hs, "Key Deliverables"))
	)
		return "epic";
	if (headingPresent(hs, "Research Question") && headingPresent(hs, "Time Box"))
		return "spike";
	if (
		headingPresent(hs, "Steps to Reproduce") &&
		headingPresent(hs, "Impact Assessment")
	)
		return "bug";
	if (headingPresent(hs, "Story") && headingPresent(hs, "Context"))
		return "story";
	if (
		hasPartOf(body) &&
		headingPresent(hs, "Purpose") &&
		headingPresent(hs, "Out of scope")
	)
		return "child";
	if (headingPresent(hs, "Technical Approach")) return "task";
	return null;
}

// ── Date rules (Zod superRefine — the cross-field invariants) ────────────────
//
// All inputs are date-only YYYY-MM-DD, so a string compare IS a chronological
// compare (zero-padded), with no Date parsing / timezone hazard.

const DateRulesSchema = z
	.object({
		startDate: z.string(),
		targetDate: z.string(),
		milestoneDueOn: z.string().nullable(),
	})
	.superRefine((val, ctx) => {
		if (val.startDate > val.targetDate)
			ctx.addIssue({
				code: "custom",
				path: ["targetDate"],
				message: `target date ${val.targetDate} is before start date ${val.startDate}`,
			});
		if (val.milestoneDueOn !== null && val.targetDate > val.milestoneDueOn)
			ctx.addIssue({
				code: "custom",
				path: ["targetDate"],
				message: `target date ${val.targetDate} is after milestone due date ${val.milestoneDueOn}`,
			});
	});

const isIso = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

type Push = (
	severity: Severity,
	code: string,
	message: string,
	field?: string,
) => void;

function validateProjectFields(issue: NormalizedIssue, push: Push): void {
	if (issue.project === null) {
		push(
			"ERROR",
			"NOT_ON_BOARD",
			"issue is not on the project board",
			"project",
		);
		return;
	}
	const p = issue.project;
	if (!p.status) push("ERROR", "STATUS_UNSET", "Status is not set", "status");

	const { startDate: start, targetDate: target } = p;
	if (!start)
		push(
			"ERROR",
			"START_DATE_UNSET",
			"Start date is not set (required for the roadmap)",
			"start date",
		);
	else if (!isIso(start))
		push(
			"ERROR",
			"START_DATE_INVALID",
			`Start date "${start}" is not YYYY-MM-DD`,
			"start date",
		);

	if (!target)
		push(
			"ERROR",
			"TARGET_DATE_UNSET",
			"Target date is not set (required for the roadmap)",
			"target date",
		);
	else if (!isIso(target))
		push(
			"ERROR",
			"TARGET_DATE_INVALID",
			`Target date "${target}" is not YYYY-MM-DD`,
			"target date",
		);

	if (start && target && isIso(start) && isIso(target)) {
		const due = p.milestone?.dueOn ?? issue.milestone?.dueOn ?? null;
		const parsed = DateRulesSchema.safeParse({
			startDate: start,
			targetDate: target,
			milestoneDueOn: due,
		});
		if (!parsed.success)
			for (const iss of parsed.error.issues)
				push("ERROR", "DATE_ORDER", iss.message, "target date");
	}

	if (!issue.milestone && !p.milestone)
		push(
			"WARN",
			"MILESTONE_UNSET",
			"no milestone set (recommended)",
			"milestone",
		);
}

/** The heart of the validator: structural + field checks for one issue. PURE. */
export function validateTicket(
	issue: NormalizedIssue,
	type: TicketType,
): Violation[] {
	const out: Violation[] = [];
	const push: Push = (severity, code, message, field) =>
		out.push({ issue: issue.number, severity, code, message, field });
	const spec = TICKET_SPECS[type];
	const headings = parseHeadings(issue.body);

	for (const req of spec.headings)
		if (!req.anyOf.some((name) => headingPresent(headings, name)))
			push(
				"ERROR",
				req.code,
				`missing required section "## ${req.label}"`,
				req.label,
			);

	if (spec.requireCurrentDesired) {
		const combined = headingPresent(headings, "Current / Desired behaviour");
		const split =
			headingPresent(headings, "Current behaviour") &&
			headingPresent(headings, "Desired behaviour");
		if (!combined && !split)
			push(
				"ERROR",
				"MISSING_CURRENT_DESIRED",
				'missing "## Current / Desired behaviour" (or both "## Current behaviour" and "## Desired behaviour")',
				"Current / Desired behaviour",
			);
	}

	if (spec.requireWorkReadiness) {
		const wr = parseWorkReadiness(issue.body);
		if (!wr.present)
			push(
				"ERROR",
				"MISSING_WORK_READINESS",
				'missing "**Work-readiness:** AFK|HITL" tag',
				"Work-readiness",
			);
		else if (wr.type === "HITL" && !wr.hasReason)
			push(
				"WARN",
				"HITL_NO_REASON",
				'HITL tag should give a one-line reason ("HITL — <reason>")',
				"Work-readiness",
			);
	}

	if (spec.acHeadings) {
		if (!spec.acHeadings.some((n) => headingPresent(headings, n)))
			push(
				"ERROR",
				"MISSING_AC",
				'missing "## Acceptance Criteria" section',
				"Acceptance Criteria",
			);
		else if (checkboxCountUnder(issue.body, spec.acHeadings) < 1)
			push(
				"ERROR",
				"AC_NO_CHECKBOXES",
				'Acceptance Criteria has no checkbox ("- [ ]") items',
				"Acceptance Criteria",
			);
		else
			for (const phrase of weakPhrasesInAc(issue.body, spec.acHeadings))
				push(
					"WARN",
					"WEAK_AC",
					`acceptance criterion contains vague phrase "${phrase}"`,
					"Acceptance Criteria",
				);
	}

	if (spec.requirePartOf && !hasPartOf(issue.body))
		push(
			"ERROR",
			"MISSING_PART_OF",
			'child slice must reference its epic with "Part of #<n>"',
			"Part of",
		);

	if (
		spec.visualEvidenceForUiBug &&
		!headingPresent(headings, "Visual Evidence")
	)
		push(
			"WARN",
			"MISSING_VISUAL_EVIDENCE",
			'no "## Visual Evidence" section (required for UI bugs)',
			"Visual Evidence",
		);

	validateProjectFields(issue, push);

	if (spec.minSubIssues > 0 && issue.subIssues.length < spec.minSubIssues)
		push(
			"ERROR",
			"EPIC_NO_CHILDREN",
			`epic has ${issue.subIssues.length} sub-issue(s), needs >= ${spec.minSubIssues}`,
			"sub-issues",
		);

	return out;
}
