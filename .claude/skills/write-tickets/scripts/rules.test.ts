import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	checkboxCountUnder,
	detectType,
	headingPresent,
	type NormalizedIssue,
	normalize,
	parseHeadings,
	parseWorkReadiness,
	RawIssueSchema,
	RawProjectItemSchema,
	type Violation,
	validateTicket,
} from "./rules";

const FX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function normFixture(name: string): NormalizedIssue {
	const raw = JSON.parse(readFileSync(join(FX, `${name}.json`), "utf8")) as {
		issue: unknown;
		item: unknown;
		subIssues: number[];
	};
	return normalize(
		RawIssueSchema.parse(raw.issue),
		RawProjectItemSchema.parse(raw.item),
		raw.subIssues,
	);
}

const errorCodes = (vs: Violation[]): string[] =>
	vs.filter((v) => v.severity === "ERROR").map((v) => v.code);

// ── Captured real fixtures: boundary + normalize + validate end-to-end ───────

test("good epic fixture (#44) validates clean as an epic", () => {
	const vs = validateTicket(normFixture("good-epic-44"), "epic");
	assert.deepEqual(errorCodes(vs), [], JSON.stringify(vs, null, 2));
});

test("good child fixture (#45, split Current/Desired) validates clean as a child", () => {
	const vs = validateTicket(normFixture("good-child-45"), "child");
	assert.deepEqual(errorCodes(vs), [], JSON.stringify(vs, null, 2));
});

test("missing Target date is an ERROR naming the target date field (the original miss)", () => {
	const vs = validateTicket(normFixture("bad-missing-target-date"), "child");
	const targetErr = vs.find(
		(v) => v.severity === "ERROR" && v.field === "target date",
	);
	assert.ok(targetErr, "expected an ERROR on the target date field");
	assert.equal(targetErr?.code, "TARGET_DATE_UNSET");
});

// ── Markdown predicates ──────────────────────────────────────────────────────

test("parseHeadings finds H2/H3 and matches case-insensitively", () => {
	const hs = parseHeadings("## Purpose\nbody\n### Time Box\nmore\n");
	assert.ok(headingPresent(hs, "purpose"));
	assert.ok(headingPresent(hs, "Time Box"));
	assert.ok(!headingPresent(hs, "References"));
});

test("checkboxCountUnder is scoped to the AC section", () => {
	const body =
		"## Acceptance Criteria\n- [ ] one\n- [x] two\n## Other\n- [ ] not counted\n";
	assert.equal(checkboxCountUnder(body, ["Acceptance Criteria"]), 2);
});

test("parseWorkReadiness handles AFK, HITL+reason, HITL-no-reason, absent", () => {
	assert.deepEqual(parseWorkReadiness("**Work-readiness:** AFK\n"), {
		present: true,
		type: "AFK",
		hasReason: false,
	});
	assert.deepEqual(
		parseWorkReadiness("**Work-readiness:** HITL — needs design review\n"),
		{ present: true, type: "HITL", hasReason: true },
	);
	assert.deepEqual(parseWorkReadiness("**Work-readiness:** HITL\n"), {
		present: true,
		type: "HITL",
		hasReason: false,
	});
	assert.equal(parseWorkReadiness("no tag here\n").present, false);
});

// ── Hand-built normalized issues for per-type coverage ───────────────────────

const GOOD_PROJECT = {
	status: "Todo",
	startDate: "2026-06-22",
	targetDate: "2026-06-23",
	milestone: { title: "M1.5", dueOn: "2026-07-01" },
	team: null,
};

function mk(
	over: Partial<NormalizedIssue> & { body: string },
): NormalizedIssue {
	return {
		number: 99,
		title: "Test",
		body: "",
		url: "https://github.com/o/r/issues/99",
		labels: [],
		milestone: { title: "M1.5", dueOn: "2026-07-01" },
		project: { ...GOOD_PROJECT },
		subIssues: [],
		...over,
	};
}

const STORY_OK =
	"**Work-readiness:** AFK\n## Story\nAs a user, I want X, so that Y.\n## Context\nc\n## Acceptance Criteria\n- [ ] a specific check\n";
const EPIC_OK =
	"## Goal\ng\n## Business Context\nb\n## Scope\ns\n## Key Deliverables\nk\n## Dependencies\nd\n## Risks and Mitigations\nr\n";
const SPIKE_NO_TIMEBOX =
	"**Work-readiness:** AFK\n## Research Question\nq\n## Goals/Questions to Answer\n- [ ] g\n## Deliverable\nd\n## Follow-up Actions\nf\n## Acceptance Criteria\n- [ ] a\n";
const CHILD_OK =
	"**Work-readiness:** AFK\n## Purpose\np\n## Current / Desired behaviour\nx\n## Acceptance criteria\n- [ ] a\n## Out of scope\no\n## References\nr\n\nPart of #44\n";

test("story missing its AC section is flagged MISSING_AC", () => {
	const vs = validateTicket(
		mk({ body: STORY_OK.replace(/## Acceptance Criteria[\s\S]*/, "") }),
		"story",
	);
	assert.ok(errorCodes(vs).includes("MISSING_AC"));
});

test("spike without a Time Box is flagged MISSING_TIMEBOX", () => {
	const vs = validateTicket(mk({ body: SPIKE_NO_TIMEBOX }), "spike");
	assert.ok(errorCodes(vs).includes("MISSING_TIMEBOX"));
});

test("epic with no sub-issues is flagged EPIC_NO_CHILDREN", () => {
	const vs = validateTicket(mk({ body: EPIC_OK, subIssues: [] }), "epic");
	assert.ok(errorCodes(vs).includes("EPIC_NO_CHILDREN"));
});

test("epic with sub-issues and full body validates clean", () => {
	const vs = validateTicket(mk({ body: EPIC_OK, subIssues: [1, 2] }), "epic");
	assert.deepEqual(errorCodes(vs), [], JSON.stringify(vs, null, 2));
});

test("child without Part of is flagged MISSING_PART_OF", () => {
	const vs = validateTicket(
		mk({ body: CHILD_OK.replace("Part of #44\n", "") }),
		"child",
	);
	assert.ok(errorCodes(vs).includes("MISSING_PART_OF"));
});

test("child with only a split Current heading (no Desired) is flagged", () => {
	const body = CHILD_OK.replace(
		"## Current / Desired behaviour",
		"## Current behaviour",
	);
	const vs = validateTicket(mk({ body }), "child");
	assert.ok(errorCodes(vs).includes("MISSING_CURRENT_DESIRED"));
});

test("baseline good child validates clean", () => {
	assert.deepEqual(
		errorCodes(validateTicket(mk({ body: CHILD_OK }), "child")),
		[],
	);
});

test("start date after target date is a DATE_ORDER error", () => {
	const vs = validateTicket(
		mk({
			body: CHILD_OK,
			project: {
				...GOOD_PROJECT,
				startDate: "2026-06-25",
				targetDate: "2026-06-23",
			},
		}),
		"child",
	);
	assert.ok(errorCodes(vs).includes("DATE_ORDER"));
});

test("target date after the milestone due date is a DATE_ORDER error", () => {
	const vs = validateTicket(
		mk({
			body: CHILD_OK,
			project: { ...GOOD_PROJECT, targetDate: "2026-07-05" },
		}),
		"child",
	);
	const dateErr = vs.find((v) => v.code === "DATE_ORDER");
	assert.ok(dateErr && /milestone due date/.test(dateErr.message));
});

test("an issue not on the board is flagged NOT_ON_BOARD", () => {
	const vs = validateTicket(mk({ body: CHILD_OK, project: null }), "child");
	assert.ok(errorCodes(vs).includes("NOT_ON_BOARD"));
});

// ── Type detection ───────────────────────────────────────────────────────────

test("detectType resolves each type from body markers", () => {
	assert.equal(detectType(EPIC_OK, []), "epic");
	assert.equal(detectType(CHILD_OK, []), "child");
	assert.equal(
		detectType(
			SPIKE_NO_TIMEBOX.replace("## Goals", "## Time Box\nt\n## Goals"),
			[],
		),
		"spike",
	);
	assert.equal(
		detectType("## Impact Assessment\ni\n## Steps to Reproduce\ns\n", []),
		"bug",
	);
	assert.equal(detectType(STORY_OK, []), "story");
	assert.equal(
		detectType("## Purpose\np\n## Technical Approach\nt\n", []),
		"task",
	);
	assert.equal(detectType("nothing structured here", []), null);
});

test("detectType treats the epic label as authoritative", () => {
	assert.equal(detectType("no markers", ["epic"]), "epic");
});
