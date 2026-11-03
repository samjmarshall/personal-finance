# Layout lint rules: blank lines and braces

Date: 2026-11-03
Status: Design (validated in brainstorm; ready for `/write-plan`)

## Problem

The Biome formatter keeps blank lines but never adds them. It also turns a long one-line
`if` into a brace-less two-line `if`:

```ts
if (take(pair))
	result.flag.push({ ... });
```

Biome has no rule that requires blank lines around blocks or before `return`. Its
`useBlockStatements` rule has no options: braces everywhere or nowhere. The code has
mixed spacing and brace-less bodies that span many lines.

Goal: enforce blank lines around blocks and before exits, and require braces wherever a
body spans more than one line. Both must autofix.

## Rules

### Rule 1: blank lines (Oxlint, `@stylistic/padding-line-between-statements`)

| Where | Blank line |
|---|---|
| Above and below a block statement: `if`, `for`, `while`, `do`, `switch`, `try`, any `{…}` block | required |
| Above an exit: `return`, `throw`, `continue`, `break` | required |
| Between two side-by-side one-line `if`s (a guard group) | allowed, not required |
| First or last statement in a block | never required |

- A one-line `if` next to a braced `if` still needs the blank line.
- When a comment sits above a statement, the blank line goes above the comment.
- The rule applies inside `switch` cases and at the top level of a file.

### Rule 2: braces (Biome, three GritQL plugins)

| Case | Braces | Plugin |
|---|---|---|
| Any loop: `for`, `for…of`, `for…in`, `while`, `do` | always | `loop-braces.grit` |
| Any `if` that has an `else` | on every branch | `if-chain-braces.grit` |
| A lone `if` that fits on one line | optional | — |
| A lone `if` that spans lines (long condition, or body on the next line) | required | `if-multiline-braces.grit` |

Messages:

- "Loops need braces."
- "An if with an else needs braces on every branch."
- "Add braces, or fit the whole if on one line."

Each plugin rewrites the body to `{ $body }` with `fix_kind="safe"`. Wrapping never
changes behaviour.

The formatter always splits `if (a) x(); else y();` onto two lines, so the `else` rule
follows from "brace-less only on one line".

### Out of scope

- Blank lines around other statements (`const`, calls).
- Blank lines between class members.
- Grouping or stacking rules for `return`s.

## Verified facts

Spikes in `/tmp` confirmed these (Biome 2.6.4, Oxlint 1.90.0, `@stylistic/eslint-plugin`
5.10.0, Node 24):

- Biome 2.6.4 is the latest release. It loads only GritQL plugins; JS plugins are not
  available.
- Biome maintainers declined a native padding rule
  ([discussion #10879](https://github.com/biomejs/biome/discussions/10879)).
- GritQL ignores whitespace between nodes
  ([GritQL reference](https://biomejs.dev/reference/gritql/)). A regex on a node's own text
  does see the newlines inside it, so `$if <: r"(?s).*\n.*"` detects a multi-line `if`.
- Grit rewrites with `fix_kind="safe"` apply under `biome check --write`.
- Biome lints before it formats. A long one-line `if` gets split on the first
  `biome check --write` and braced on the second.
- A Grit regex over a function body can find a missing blank line, but its rewrite also
  inserted a blank line inside a template literal. That changes runtime output, so blank
  lines stay in Oxlint, which works on the AST.
- Oxlint loads `@stylistic/eslint-plugin` as a `jsPlugin`, and its fixer works under
  `oxlint --fix`. Oxlint parses TS and TSX natively and needs no `typescript` package, so
  TypeScript 7 does not affect it.
- The pipeline `biome check --write` ×2 → `oxlint --fix` turns all three examples from the
  brief into the target output. It leaves multi-line template literals untouched, and a
  second run changes nothing.
- `.oxlintrc.json` accepts `//` and `/* */` comments. `// biome-ignore lint/plugin/<file-name>:`
  suppresses one Grit plugin on the next line.
- Repo dry run: 1,245 problems in 224 files (1,102 blank lines, 77 multi-line `if`s,
  43 `else` chains, 23 loops). Grit counts match an AST-based rule exactly. Biome with the
  plugins took 0.24s over `src/` and `scripts/`, and Oxlint took 0.28s.

## Architecture

Biome formats, runs every existing lint rule, and enforces braces through Grit plugins.
Oxlint runs one rule: blank lines. All its default categories are off, so the two tools
never overlap. Biome's `useBlockStatements` stays off. The 318 brace-less one-line `if`s
pass today.

### Grit plugins (verified in the spike)

```grit
// loop-braces.grit
language js
or {
	JsForStatement(body=$body), JsForInStatement(body=$body), JsForOfStatement(body=$body),
	JsWhileStatement(body=$body), JsDoWhileStatement(body=$body)
} where {
	$body <: not JsBlockStatement(),
	register_diagnostic(span=$body, message="Loops need braces.", severity="error", fix_kind="safe"),
	$body => `{ $body }`
}

// if-chain-braces.grit
language js
or {
	JsIfStatement(consequent=$body, else_clause=JsElseClause()),
	JsElseClause(alternate=JsIfStatement(consequent=$body)),
	JsElseClause(alternate=$body) where { $body <: not JsIfStatement() }
} where {
	$body <: not JsBlockStatement(),
	register_diagnostic(span=$body, message="An if with an else needs braces on every branch.", severity="error", fix_kind="safe"),
	$body => `{ $body }`
}

// if-multiline-braces.grit: lone ifs only; chained ifs belong to if-chain-braces.grit
language js
JsIfStatement(consequent=$body, else_clause=.) as $if where {
	$if <: not within JsElseClause(alternate=$if),
	$body <: not JsBlockStatement(),
	$if <: r"(?s).*\n.*",
	register_diagnostic(span=$if, message="Add braces, or fit the whole if on one line.", severity="error", fix_kind="safe"),
	$body => `{ $body }`
}
```

Without the `else_clause=.` and `within` guards, `if-multiline-braces.grit` also fired on
the 23 chains, producing duplicate errors.

### `.oxlintrc.json` rule (verified in the spike)

```json
"@stylistic/padding-line-between-statements": ["error",
  { "blankLine": "always", "prev": "*", "next": ["if", "for", "while", "do", "switch", "try", "block-like"] },
  { "blankLine": "always", "prev": ["if", "for", "while", "do", "switch", "try", "block-like"], "next": "*" },
  { "blankLine": "any", "prev": "if", "next": "if" },
  { "blankLine": "always", "prev": "*", "next": "block-like" },
  { "blankLine": "always", "prev": "block-like", "next": "*" },
  { "blankLine": "always", "prev": "*", "next": ["return", "throw", "continue", "break"] }
]
```

The last matching entry wins. The `any` entry lets one-line `if`s stack. The two
`block-like` entries come after it, so a braced `if` still needs its blank lines.

## Components

| File | Change |
|---|---|
| `biome-plugins/loop-braces.grit`, `if-chain-braces.grit`, `if-multiline-braces.grit` (new) | The three brace rules. |
| `biome.jsonc` | Add the three plugins to `plugins`. |
| `package.json` | Add `oxlint@1.90.0` and `@stylistic/eslint-plugin@5.10.0` as exact dev deps (no `^`, because jsPlugins are alpha). `check`: `biome check . && oxlint`. `check:write`: `biome check --write . && biome check --write . && oxlint --fix` |
| `.oxlintrc.json` (new) | Turn off all categories. Load `@stylistic/eslint-plugin`. Turn on the padding rule as `error`. Ignore what Biome ignores: `.claude/worktrees`, `.claude/skills/subagent-eval/*-template.js`. |
| `src/test/layout-lint.test.ts` (new) | Fixture test (see Testing). `src/test/` already sits inside Vitest's `unit` include, so `vitest.config.ts` stays as is. |
| `.claude/scripts/biome-check.sh` | Run Biome twice on the edited file, then `oxlint --fix`. Stays best-effort (`|| true`). |
| `.git-blame-ignore-revs` (new) | Hash of the rollout style commit. |
| `AGENTS.md` | Mention Oxlint in the `make check` and `make fix` lines. |

Unchanged: `Makefile` (it calls the `pnpm` scripts), `quality-control.yml` (it runs
`make check`), `vitest.config.ts`.

### Why-comments instead of an ADR

Code comments record why Oxlint exists, so no ADR is needed. Two places carry the comment:

- At the top of `.oxlintrc.json`, which accepts comments.
- Next to `plugins` in `biome.jsonc`, where a Biome reader looks first.

Each comment states:

- **Why:** Biome has no blank-line rule
  ([discussion #10879](https://github.com/biomejs/biome/discussions/10879)), and Grit
  plugins cannot see whitespace between statements.
- **Exit condition:** remove Oxlint when Biome ships a padding rule, or a plugin API that
  sees whitespace and can fix it. Then move Rule 1 into Biome and delete `.oxlintrc.json`,
  the two dev deps, and the Oxlint steps in `package.json` and the edit hook.
- **Pins** (`.oxlintrc.json` only): `oxlint` and `@stylistic/eslint-plugin` use exact
  versions because jsPlugins are alpha. `package.json` cannot hold that comment.

## Data flow

`make fix` runs three steps:

1. `biome check --write .`: format, and brace anything already multi-line.
2. `biome check --write .`: brace the long `if`s that step 1 split. Biome lints before it
   formats, so step 1 cannot see them.
3. `oxlint --fix`: add blank lines. Braces are final by now, so one pass is enough.

Oxlint only adds blank lines, and Biome keeps them, so no final Biome pass is needed.

`make check` and CI run `biome check .` then `oxlint`, with no writes. Brace errors show
up in the editor through the Biome extension.

## Error handling

| Risk | Handling |
|---|---|
| An Oxlint bump breaks jsPlugins (alpha, no semver) | Exact pins. The fixture test and `make check` fail on the Renovate PR, so we don't merge it. Only the blank-line rule depends on jsPlugins. |
| A plugin fails to load | Biome reports "Failed to compile the Grit plugin" and Oxlint exits non-zero, so `make check` fails. The edit hook ignores the failure and never blocks an edit. |
| A Biome bump changes Grit node names | The fixture test fails on the Renovate PR. |
| The multi-line regex matches a multi-line template literal inside a one-line `if` | It adds braces. That is harmless. |
| A later step creates a new problem | `make check` catches it, and a second `make fix` clears it. No loop until clean (YAGNI). |
| Biome trims added blank lines | It keeps single blank lines and trims them only at block start or end, which Rule 1 never asks for. The spike confirmed it stays stable. |
| A spot needs an exception | Oxlint: `// oxlint-disable-next-line @stylistic/padding-line-between-statements`. Grit: `// biome-ignore lint/plugin/<file-name>: <reason>`, e.g. `lint/plugin/loop-braces` (verified). |

## Testing

`src/test/layout-lint.test.ts` holds each case as two inline strings, `input` and
`expected`. Inline strings keep malformed fixtures out of the repo, where Biome would
reformat them and `tsc` would flag unknown names.

For each case, the test:

1. Writes `input` to a temp folder as a `.ts` file.
2. Runs the three-step pipeline against the repo's `biome.jsonc` and `.oxlintrc.json`.
   Biome needs `--vcs-enabled=false` for files outside the repo root.
3. Asserts that the output equals `expected`, and that `biome check` and `oxlint` are clean.
4. Reruns the pipeline on `expected` and asserts that nothing changes.

Cases:

- The three brief examples: a long `if` in a loop, a one-line `for`, and the `take` arrow function.
- A guard group: stays together, gets blank lines around it, and gets a blank before `return`.
- A one-line `if` beside a braced `if`.
- An `else if` / `else` chain, and a braced `if` with a brace-less `else if`.
- A lone `if` with a long condition.
- `while` and `do` loops.
- A comment above an `if`.
- A multi-line template literal containing `return`, which stays untouched.
- A `switch` case with a statement before its `return`.
- `try`/`catch`, then `throw`.
- First and last statements in a block, which stay untouched.

The test spawns real binaries, so it takes about a second.

## Rollout

One PR on a new branch off `main` (e.g. `chore/layout-lint`):

1. `chore(lint): add layout rules`: Grit plugins, Oxlint, config, test, hook, and docs.
2. `style: apply layout rules`: `make fix` output only, with no hand edits.
3. `chore: ignore layout commit in blame`: commit 2's hash in `.git-blame-ignore-revs`.

- Merge with a merge commit. A squash merge gives commit 2 a new hash, which breaks the
  blame-ignore entry. The repo allows merge commits.
- Before merging, run `make check`, `make test`, and `make build`. `git diff -w` on commit 2
  should show only added braces.
- Branches with open work (e.g. `feat/adr029-description-scores`) should merge first, or
  rebase afterwards and run `make fix`. Most conflicts will be blank lines.
- GitHub reads `.git-blame-ignore-revs` on its own. For local blame, the PR description
  gives the one-time command `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Rejected

- **Biome only.** Grit handles braces, but the only blank-line approach is a regex over raw
  function text. That edited a template literal in the spike, and its errors point at the
  whole function.
- **All layout rules in Oxlint, with a custom braces jsPlugin.** It worked in the spike, but
  it put ~50 lines of custom code on Oxlint's alpha plugin API. Grit does the same job in
  ~10 lines per rule on a plugin system the repo already uses.
- **ESLint with `@stylistic`.** It is slower, and its TypeScript parser relies on TypeScript's
  JS API, which TypeScript 7 may not ship (secondhand, not tested).
- **Prettier.** It is a formatter like Biome: it never adds blank lines, and it would fight
  Biome over every file.
- **Oxlint native `curly: multi-line`.** It has one setting for every statement type, and it
  allows brace-less `else` chains.
- **Warnings with gradual fixes, or linting changed files only.** The code would stay mixed
  for months.
- **ESLint `RuleTester`, or no tests.** RuleTester adds ESLint and tests neither the config
  nor the runtimes. Without tests, nothing would catch breakage when a tool updates.
