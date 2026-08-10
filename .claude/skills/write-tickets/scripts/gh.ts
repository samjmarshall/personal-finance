// Impure boundary: the only module that shells out to `gh`. Every payload is
// Zod-parsed at the seam so a GitHub API shape change fails loudly with a path,
// not a silent `undefined`. Pure logic lives in `rules.ts`.

import { execSync } from "node:child_process";
import { z } from "zod";
import {
	RawBoardSchema,
	type RawIssue,
	RawIssueSchema,
	type RawProjectItem,
} from "./rules";

// Expected project field display names (lowercased). A board rename silently
// drops the JSON key → `assertExpectedFields` turns that into a hard failure
// instead of a validator that quietly passes everything.
const REQUIRED_FIELD_NAMES = ["status", "start date", "target date"];

/** Operational failure (gh missing/unauth, API shape drift, board rename). Exit 2. */
export class GhError extends Error {}

function sh(cmd: string): string {
	try {
		return execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	} catch (err) {
		throw new GhError(`command failed: ${cmd}\n${(err as Error).message}`);
	}
}

function parseJson(raw: string, cmd: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new GhError(`could not parse JSON from: ${cmd}`);
	}
}

// --- Repo / project discovery -------------------------------------------------
// No repo or project number is hard-coded. REPO comes from the local git context
// (gh resolves the default remote); the project NUMBER + OWNER come from the
// repo's single linked Projects v2 board. This keeps the validator identical
// across repos — drop it into any repo with one linked board and it just works.
// Escape hatch: `TICKET_PROJECT` overrides discovery (CI / a repo with >1 board).

interface RepoContext {
	repo: string; // "owner/name"
	owner: string; // project owner login (== repo owner in the common case)
	project: string; // Projects v2 board number, as a string
}

const RepoViewSchema = z.object({ nameWithOwner: z.string() });

const LinkedProjectsSchema = z.object({
	data: z.object({
		repository: z.object({
			projectsV2: z.object({
				nodes: z.array(
					z.object({
						number: z.number(),
						title: z.string(),
						closed: z.boolean(),
						owner: z.object({ login: z.string() }),
					}),
				),
			}),
		}),
	}),
});

const LINKED_PROJECTS_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:20){nodes{number title closed owner{... on User{login} ... on Organization{login}}}}}}`;

let _ctx: RepoContext | null = null;

/** Resolve repo/owner/project once per process; memoized. Throws GhError on a
 *  missing remote, an unreadable board, or a zero/ambiguous linked-board count. */
export function resolveContext(): RepoContext {
	if (_ctx) return _ctx;

	const repoCmd = "gh repo view --json nameWithOwner";
	const repo = RepoViewSchema.parse(
		parseJson(sh(repoCmd), repoCmd),
	).nameWithOwner;
	const [repoOwner, name] = repo.split("/");
	if (!repoOwner || !name)
		throw new GhError(`could not parse owner/name from "${repo}"`);

	const override = process.env.TICKET_PROJECT?.trim();
	if (override) {
		if (!/^\d+$/.test(override))
			throw new GhError(
				`TICKET_PROJECT must be a project number, got "${override}"`,
			);
		_ctx = { repo, owner: repoOwner, project: override };
		return _ctx;
	}

	const gqlCmd = `gh api graphql -f owner=${repoOwner} -f name=${name} -f query='${LINKED_PROJECTS_QUERY}'`;
	const nodes = LinkedProjectsSchema.parse(parseJson(sh(gqlCmd), gqlCmd)).data
		.repository.projectsV2.nodes;
	const open = nodes.filter((n) => !n.closed);
	if (open.length === 0)
		throw new GhError(
			`no open linked Projects v2 board for ${repo} — link one to the repo, or set TICKET_PROJECT`,
		);
	if (open.length > 1)
		throw new GhError(
			`${repo} has ${open.length} linked boards (${open
				.map((n) => `#${n.number} ${n.title}`)
				.join(", ")}) — set TICKET_PROJECT to disambiguate`,
		);

	_ctx = { repo, owner: open[0].owner.login, project: String(open[0].number) };
	return _ctx;
}

/** Fetch one issue. Guards against PR/issue number collisions via the URL. */
export function fetchIssue(n: number): RawIssue {
	const { repo } = resolveContext();
	const cmd = `gh issue view ${n} --repo ${repo} --json number,title,body,labels,milestone,url`;
	const parsed = RawIssueSchema.safeParse(parseJson(sh(cmd), cmd));
	if (!parsed.success)
		throw new GhError(
			`issue #${n}: unexpected gh shape — ${parsed.error.message}`,
		);
	if (!/\/issues\/\d+$/.test(parsed.data.url))
		throw new GhError(
			`#${n} is not an issue (got ${parsed.data.url}) — PR number?`,
		);
	return parsed.data;
}

/** Fetch the whole board once into a number→item map. Guards against pagination truncation. */
export function fetchBoard(): Map<number, RawProjectItem> {
	const { owner, project } = resolveContext();
	const cmd = `gh project item-list ${project} --owner ${owner} --format json --limit 200`;
	const parsed = RawBoardSchema.safeParse(parseJson(sh(cmd), cmd));
	if (!parsed.success)
		throw new GhError(`board: unexpected gh shape — ${parsed.error.message}`);
	if (parsed.data.items.length < parsed.data.totalCount)
		throw new GhError(
			`board truncated: read ${parsed.data.items.length}/${parsed.data.totalCount} items — raise --limit`,
		);
	const map = new Map<number, RawProjectItem>();
	for (const item of parsed.data.items) map.set(item.content.number, item);
	return map;
}

/** Child issue numbers of an epic, in board order. */
export function fetchSubIssues(n: number): number[] {
	const { repo } = resolveContext();
	const cmd = `gh api /repos/${repo}/issues/${n}/sub_issues --jq 'map(.number)'`;
	return z.array(z.number()).parse(parseJson(sh(cmd), cmd));
}

const FieldListSchema = z.object({
	fields: z.array(z.object({ name: z.string() })),
});

/** Rename guard: fail hard if an expected project field name is gone. */
export function assertExpectedFields(): void {
	const { owner, project } = resolveContext();
	const cmd = `gh project field-list ${project} --owner ${owner} --format json`;
	const parsed = FieldListSchema.safeParse(parseJson(sh(cmd), cmd));
	if (!parsed.success)
		throw new GhError(
			`field-list: unexpected gh shape — ${parsed.error.message}`,
		);
	const names = new Set(parsed.data.fields.map((f) => f.name.toLowerCase()));
	for (const required of REQUIRED_FIELD_NAMES)
		if (!names.has(required))
			throw new GhError(
				`project field "${required}" not found — renamed? The validator reads fields by name.`,
			);
}
