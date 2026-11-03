---
date: 2026-11-03
design: thoughts/designs/2026-11-03-layout-lint-rules.md
adrs: []
status: Done
---
# Layout Lint Rules Implementation Plan

## Context
Biome's formatter keeps blank lines but never adds them. It also turns a long one-line `if` into a brace-less `if` that spans two lines. The code has mixed spacing and brace-less bodies that run over many lines. This work adds two rules that both autofix: blank lines around blocks and before exits (Oxlint), and braces wherever a body spans more than one line (three Biome Grit plugins). It then applies them to the whole repo in one PR.

## Current State
- `biome.jsonc:4` loads one Grit plugin, `./biome-plugins/no-namespace-suspense.grit`. Its one-line comment at `biome-plugins/no-namespace-suspense.grit:1` is the style to copy.
- `biome.jsonc:25-31` leaves out `.claude/skills/subagent-eval/*-template.js` and `.claude/worktrees`. `.claude/worktrees` is **not** gitignored, but `.worktrees/` is (`.gitignore:63`).
- `package.json:13` `check` is `biome check .`. `package.json:15` `check:write` is `biome check --write .`. `@biomejs/biome` is `^2.5.15` (`package.json:85`) and 2.6.4 is installed.
- `Makefile:39-45`: `make check` runs `pnpm run check`, typecheck and `db:check`. `make fix` runs `pnpm run check:write`. Neither changes.
- `.husky/pre-commit:1` runs `make check` against the **working tree**. A commit fails while any layout problem is left anywhere in the repo.
- `.husky/commit-msg:15` blocks any commit message with an attribution trailer (`Co-Authored-By:` or `noreply@anthropic.com`).
- `.claude/scripts/biome-check.sh:14-17` runs `biome check --write` once on the edited file, best-effort (`|| true`). It is registered as a PostToolUse hook at `.claude/settings.json:97`.
- `vitest.config.ts:18-22`: the `unit` project includes `src/**/*.test.ts`, so a new file in `src/test/` runs with no config change. The house test style is `describe`/`it.each` from `vitest` (`src/app/(dashboard)/_components/balance-snapshot.display.test.ts:1-12`).
- `.github/workflows/quality-control.yml:22-23` runs `make check`, so CI picks up Oxlint through the `check` script.
- `AGENTS.md:16-17` describes `make check` and `make fix` without Oxlint.
- The design's brief examples live in `src/domain/transactions/reconcile-synced.ts:235-241` (the `take` arrow function), `:254-261` and `:271-279` (long `if` in a loop), and `:281` (one-line `for`).
- Checked while planning (Oxlint 1.90.0, Biome 2.6.4):
  - Oxlint finds `jsPlugins: ["@stylistic/eslint-plugin"]` by package name.
  - Oxlint skips gitignored folders on its own, and `ignorePatterns: [".claude/worktrees/**"]` works.
  - `.oxlintrc.json` accepts a `//` comment at the top, and `node_modules/oxlint/configuration_schema.json` exists.
  - `biome check --config-path=<repo> --vcs-enabled=false <file in /tmp>` applies the repo config.
  - `git diff -w` still shows added blank lines. Use `git diff -w --ignore-blank-lines` to see only the brace changes.
- Open PR #125 (`claude/ecstatic-archimedes-utt3xh`) is feature work that will conflict. `feat/adr029-description-scores` is already merged.

## Desired End State
- `make fix` runs `biome check --write .` twice, then `oxlint --fix`.
- `make check` runs `biome check .`, then `oxlint` (no writes), and fails on any missing blank line or brace.
- Loops always have braces, every branch of an `if` with an `else` has braces, and a lone `if` without braces fits on one line.
- A blank line sits above and below every block statement and above every `return`, `throw`, `continue` and `break`. One-line `if`s may stack with no blank line between them.
- `src/test/layout-lint.test.ts` proves the rules on fixed inputs, proves a second run changes nothing, and proves that `make check` would fail on bad input.
- The whole repo passes. The style change is one commit, listed in `.git-blame-ignore-revs`. The PR merges with a merge commit.

## Out of Scope
- Blank lines around other statements (`const`, calls) and between class members.
- Grouping or stacking rules for `return`s.
- Turning on Biome's `useBlockStatements`.
- Pinning `@biomejs/biome` to an exact version.
- Changes to `Makefile`, `vitest.config.ts` and `quality-control.yml`.
- An ADR. The design puts the reasons in code comments instead.

## Approach
Work on branch `chore/layout-lint` off `main`. Build the brace rules first (Phase 1), with brace-only fixtures whose inputs already have correct blank lines, so Phase 2 leaves those cases unchanged. Phase 2 adds Oxlint for blank lines, plus the cases that need both rules. Each fixture case is one TDD slice: add the case, watch it fail, add or adjust the rule, watch it pass. **Make no commits in Phases 1–2.** The pre-commit `make check` fails until Phase 3 runs `make fix` across the repo. Phase 3 then makes the three rollout commits. Each passes the hook because the working tree is already clean.

## Phase 1: Brace rules (Biome Grit plugins)
### Changes
- Branch: `git switch -c chore/layout-lint` from `main`. The `post-checkout` hook creates the Neon branch. Nothing here touches the database.
- `src/test/layout-lint.test.ts` (new). Build the test harness first, with one case, and watch it fail:
  - `root = fileURLToPath(new URL("../..", import.meta.url))`. Binaries come from `${root}/node_modules/.bin/`.
  - `cases: { name: string; input: string; expected: string }[]`, written as inline template strings with tab indents. Inline strings keep broken code out of the repo, where Biome would reformat it and `tsc` would flag unknown names.
  - `beforeAll` (timeout ~30s):
    1. `mkdtemp(join(tmpdir(), "layout-lint-"))`, then write each `input` to `${name}.ts`.
    2. `raw = lint(dir)`, run before any fix.
    3. `pipeline(dir)`, then read every file into `first`.
    4. `clean = lint(dir)`.
    5. `pipeline(dir)` again, then read every file into `second`.
  - `afterAll` deletes the temp folder.
  - `pipeline(dir)` = `biome check --write --config-path=${root} --vcs-enabled=false ${dir}`, run twice (Biome lints before it formats). Use `spawnSync`, and don't fail on a non-zero exit.
  - `lint(dir)` = `biome check --config-path=${root} --vcs-enabled=false --max-diagnostics=500 ${dir}`. It returns `{ status, output: stdout + stderr }`. The high `--max-diagnostics` stops messages from being cut off.
  - Tests:
    - `it.each(cases)`: `first[name]` equals `expected`.
    - `second` equals `first`, so a rerun changes nothing.
    - `clean.status === 0`.
    - `raw.output` contains "Loops need braces.", "An if with an else needs braces on every branch." and "Add braces, or fit the whole if on one line."
  - Brace cases. Inputs already have correct blank lines, so Oxlint in Phase 2 changes nothing:
    - one-line `for…of` body → braced
    - `while (n) n--;` and `do n++; while (n < 3);`, set apart by blank lines → both braced
    - `if (a) x(); else if (b) y(); else z();` → every branch braced
    - braced `if` with a brace-less `else if` → the `else if` branch braced
    - lone `if` with a condition over 80 columns → split on pass 1, braced on pass 2
    - one-line `if (!a) return;` as the first statement → stays brace-less
- `biome-plugins/loop-braces.grit` (new): the `loop-braces.grit` block from the design's Architecture section, with a one-line comment at the top like `no-namespace-suspense.grit:1`.
- `biome-plugins/if-chain-braces.grit` (new): the `if-chain-braces.grit` block from the design.
- `biome-plugins/if-multiline-braces.grit` (new): the `if-multiline-braces.grit` block from the design. Keep the `else_clause=.` and `not within JsElseClause(alternate=$if)` guards. Without them it also fires on `else` chains and reports each one twice.
- `biome.jsonc:4`: add the three plugins to `plugins`. Above the line, add a comment that `useBlockStatements` has no options, so these plugins allow one-line `if`s and brace everything else.
- `package.json:15`: `check:write` becomes `biome check --write . && biome check --write .`.

### Success
- [x] `make test` passes (the `layout-lint` brace cases included)
- [x] `pnpm run typecheck` passes
- [x] Every error from `pnpm exec biome check .` is a `lint/plugin` brace diagnostic (the repo gets fixed in Phase 3)
- [x] Nothing committed yet

## Phase 2: Blank-line rule (Oxlint)
### Changes
- `package.json:84-107`: `pnpm add -D -E oxlint@1.90.0 @stylistic/eslint-plugin@5.10.0`. Exact versions, no `^`. `pnpm-lock.yaml` updates with it.
- `package.json:13`: `check` becomes `biome check . && oxlint`.
- `package.json:15`: `check:write` becomes `biome check --write . && biome check --write . && oxlint --fix`.
- `.oxlintrc.json` (new):
  - A comment at the top with three parts:
    - **Why:** Biome has no blank-line rule ([discussion #10879](https://github.com/biomejs/biome/discussions/10879)), and Grit plugins can't see whitespace between statements.
    - **Exit condition:** when Biome ships a padding rule, or a plugin API that sees whitespace and can fix it, move this rule into Biome. Then delete this file, the two dev deps, and the Oxlint steps in `package.json` and `.claude/scripts/biome-check.sh`.
    - **Pins:** `oxlint` and `@stylistic/eslint-plugin` use exact versions because jsPlugins are alpha.
  - `"$schema": "./node_modules/oxlint/configuration_schema.json"`.
  - `categories`: `correctness`, `suspicious`, `pedantic`, `perf`, `style`, `restriction` and `nursery` all `"off"`.
  - `jsPlugins: ["@stylistic/eslint-plugin"]`.
  - `ignorePatterns: [".claude/worktrees/**", ".claude/skills/subagent-eval/*-template.js"]`.
  - `rules`: the `@stylistic/padding-line-between-statements` entry from the design's Architecture section, as `"error"`. The order of its entries matters: the last match wins.
- `biome.jsonc:4`: add the **Why** and **Exit condition** comment (same wording as `.oxlintrc.json`, minus Pins) next to `plugins`, and point it at `.oxlintrc.json`.
- `src/test/layout-lint.test.ts`:
  - `pipeline(dir)` adds a third step: `oxlint -c ${root}/.oxlintrc.json --fix ${dir}`.
  - `lint(dir)` also runs `oxlint -c ${root}/.oxlintrc.json ${dir}`. Join both outputs, and `status` is non-zero if either tool fails.
  - The `raw.output` test also expects `padding-line-between-statements`.
  - New cases, one TDD slice each:
    - Guard group (`const today`, then three one-line `if … return`s, then `return null`). The `if`s stay together, get a blank line above, and get a blank line before the final `return`.
    - One-line `if` next to a braced `if` → blank line between them.
    - Comment above a `while` → the blank line goes above the comment.
    - Multi-line template literal that contains `return` → left as is.
    - `switch` case with `log(k);` before `return 1;` → blank line before the `return`.
    - `try`/`catch` followed by `throw` → blank lines around the `try` and before the `throw`.
    - First and last statements in a block → no blank line added at the start or end.
    - The three brief examples, copied from `src/domain/transactions/reconcile-synced.ts`:
      - the `take` arrow function (`:235-241`)
      - `for (const pair of …) { if (take(pair)) result.flag.push({ … }); }` (`:271-279`)
      - the one-line `for … if … result.add.push(bank)` followed by `return result` (`:281-284`)
- `.claude/scripts/biome-check.sh:14-17`:
  - Run the `biome check --write --files-ignore-unknown=true "$FILE"` call twice.
  - Then run `"$CLAUDE_PROJECT_DIR/node_modules/.bin/oxlint" -c "$CLAUDE_PROJECT_DIR/.oxlintrc.json" --fix "$FILE"`.
  - Each step ends in `2>/dev/null || true`.
  - Update the header comment (`:2-6`) to mention braces and blank lines.
- `AGENTS.md:16-17`:
  - `make check` becomes "lint + typecheck + db schema check (`pnpm run check` = Biome + Oxlint, + `pnpm run typecheck` + `pnpm run db:check`)".
  - `make fix` becomes "fix lint and layout issues (`pnpm run check:write` = Biome twice, then `oxlint --fix`)".

### Success
- [x] `make test` passes (every `layout-lint` case, including the Phase 1 cases, which stay unchanged)
- [x] `pnpm run typecheck` passes
- [x] Every error from `pnpm run check` is a layout error (a `lint/plugin` brace diagnostic, or `padding-line-between-statements`)
- [x] After editing a `.ts` file with a brace-less multi-line `if` and no blank lines, the edit hook adds braces and blank lines. Editing a `.md` file through the hook raises no error.
- [x] Nothing committed yet

## Phase 3: Apply to the repo and roll out
### Changes
- Run `make fix`. Then run `pnpm run check`. If it still reports anything, run `make fix` once more. Make no hand edits to the fixed files.
- Check the style change:
  - `git diff -w --ignore-blank-lines` on files outside Phases 1–2 shows only added `{`/`}` lines.
  - Expect around 1,245 fixes in about 224 files.
- Commit 1, `chore(lint): add layout rules`. Stage only the files from Phases 1–2:
  - `biome-plugins/*.grit`
  - `biome.jsonc`, `package.json`, `pnpm-lock.yaml`, `.oxlintrc.json`
  - `src/test/layout-lint.test.ts`
  - `.claude/scripts/biome-check.sh`, `AGENTS.md`
  - The pre-commit `make check` passes because the working tree is already fixed.
- Commit 2, `style: apply layout rules`: stage everything else from `make fix`.
- `.git-blame-ignore-revs` (new): one comment line, then the full hash of commit 2 (`git rev-parse HEAD`).
- Commit 3, `chore: ignore layout commit in blame`.
- All three commits go through the `commit` skill. No attribution trailers (`.husky/commit-msg:15` rejects them).
- Open the PR with the `pull-request` skill. The description says:
  - Merge with a **merge commit**, not squash. A squash gives commit 2 a new hash, which breaks the blame-ignore entry.
  - For local blame, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.
  - Open PR #125 should merge first, or rebase on top of this and run `make fix`. Most conflicts will be blank lines.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes
- [x] `git diff -w --ignore-blank-lines HEAD~2 HEAD~1` (commit 2) shows only added braces
- [x] Running `make fix` again changes nothing (`git status` is clean)
- [x] `.git-blame-ignore-revs` holds commit 2's hash, and `git blame` with `--ignore-revs-file .git-blame-ignore-revs` skips it
- [x] PR opened from `chore/layout-lint`, with the merge-commit note and the local blame command

## References
- Design doc: `thoughts/designs/2026-11-03-layout-lint-rules.md` (no `## Related ADRs`, no ADR candidates)
- ADRs: none (the design records the reasons in comments in `.oxlintrc.json` and `biome.jsonc`)
- Related:
  - `biome.jsonc:4`, `biome.jsonc:25-31`
  - `biome-plugins/no-namespace-suspense.grit:1-4`
  - `package.json:13`, `package.json:15`, `package.json:84-107`
  - `.claude/scripts/biome-check.sh:14-17`, `.claude/settings.json:97`
  - `.husky/pre-commit:1`, `.husky/commit-msg:15`
  - `vitest.config.ts:18-22`
  - `.github/workflows/quality-control.yml:22-23`
  - `AGENTS.md:16-17`
  - `src/domain/transactions/reconcile-synced.ts:235-284`
- Spike: `/tmp/layout-spike/` (configs and sample inputs; temporary)
