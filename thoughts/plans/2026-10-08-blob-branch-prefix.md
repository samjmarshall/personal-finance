---
date: 2026-10-08
adrs: [adr028]
status: Ready to implement
---
# Blob files branch with the database — Implementation Plan

## Context

Neon gives every git branch its own database: `local/<branch>` comes from `scripts/neon-branch.sh` and `preview/<branch>` from the Neon-Vercel integration. Vercel Blob has no branching, so every environment shares one store, and a branch database's rows point at production's files.

During the step-7 Phase 4 browser check, we found that deleting a Receipt on a branch would delete production's file. This plan makes Blob behave like Neon's copy-on-write:
- a branch reads the production files it inherited, in place
- it writes new files under its own prefix
- it deletes only files under that prefix
- teardown empties the prefix

## Current State

- **One store for all environments.** The Vercel project has `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` targeted at `production`, `preview` and `development` alike (checked via the Vercel API on 2026-10-08). `docs/README.md:24` still says "production" only. Terraform declares no store (`infrastructure/vercel.tf:55-56`). `.claude/skills/worktree/worktree.sh:148` copies the main `.env`, and with it the token, into every worktree.
- **What Vercel Blob offers** (docs, Aug–Sep 2026):
  - no environment or branch on a store, and the advice is "use separate stores to isolate environments"
  - no read-only tokens, and no copying between stores
  - `copy()` works only inside one store and is an Advanced Operation
  - blobs should be treated as immutable
- **The adapter.** `src/server/blob-store/blob-store.ts`:
  - interface `:21-34`
  - `VercelBlobStore` `:41-79`: `read` → `get` `:42-51`, `stream` → `get` `:53-57`, `write` → `put(…, addRandomSuffix: false)` `:61-74`, `delete` → `del` `:76-78`
  - It takes no constructor args. The SDK reads the token from `process.env`.
  - It is built in three places: `src/server/receipts/receipts.module.ts:21`, `src/server/inngest/functions.ts:29` and `src/app/api/receipts/inbound/route.ts:35`.
  - Tests mock the SDK at `blob-store.test.ts:5`. The delete cases are at `:121-138`.
  - A second adapter, `VercelClientUploads` (`src/server/blob-store/client-uploads.ts`), wraps `handleUpload` from `@vercel/blob/client`. It is built at `receipts.module.ts:22`.
- **Pathnames have no environment prefix.**
  - Email: `receipts/email/<uuid>.<ext>`, built by `emailBlobPathname` at `src/server/email/email.service.ts:85-89`. Its regex tests are at `email.service.test.ts:100-116`.
  - Browser upload: the user's file name, at `src/app/(dashboard)/receipts/_components/receipt-upload.tsx:61-65`, with Blob's random suffix (`addRandomSuffix: true` in the grant, `src/server/receipts/receipts.service.ts:258`).
  - `onBeforeGenerateToken` can't rewrite the pathname (`node_modules/@vercel/blob/dist/client.d.ts:346`), so the browser must build it.
- **Delete.** `ReceiptsService.delete` deletes the row, then `blobStore.delete(blobPathname)`, and swallows a store error (`src/server/receipts/receipts.service.ts:211-226`).
- **Reads go by `blobPathname`.**
  - the worker: `receipt-extraction.service.ts:300-302`
  - the image route: `ReceiptsHttpController.image` (`receipts.http.controller.ts:91-116`) calls `ReceiptsService.openImage`, which reads through `BlobStore.stream` (`receipts.service.ts:228-242`). Nothing outside the adapter calls `get`.
  - `blobUrl` is stored but never used for access.
- **Upload grant.**
  - `ReceiptsService.answerUpload` (`receipts.service.ts:244-262`) returns the policy from the grant callback it hands to `ClientUploads.answer` (`:253-261`).
  - The callback ignores the `pathname` that `client-uploads.ts:14` passes it.
  - `ReceiptsHttpController.upload` (`receipts.http.controller.ts:122-194`) maps `UploadUnauthorizedError` to 401 in `failureStatus` (`:34-40`).
  - `src/app/api/receipts/upload/route.ts` is only the composition root.
- **Env.**
  - `src/env.ts` validates at build, because `next.config.ts:2` imports it, and has `emptyStringAsUndefined: true` at `:177`.
  - Vercel-derived values use `z.preprocess` on raw `process.env.VERCEL_*` (`:42-52`, `:65-73`).
  - Precedent for namespacing state by environment: `src/server/auth/config.ts:14-26` (Redis key prefix).
- **Where the DB URL is chosen.**
  - Locally: `neon-branch.sh` `apply_branch_urls` `:130-139`, called for a branch at `:217`, for `main` at `:171-180`, and on delete restore at `:273-274`.
  - Preview: the Neon integration, keyed by `--meta githubCommitRef` in `deploy.yml:184-197`. `ENVIRONMENT` is set at `:34`.
  - The Vercel CLI has `--env` (runtime) and `--build-env` (build). `VERCEL_GIT_COMMIT_REF` isn't documented for CLI deploys, so we don't rely on it.
- **Teardown.**
  - `teardown.yml:43-67` deletes `preview/<branch>` and `local/<branch>` Neon branches, but no blobs.
  - Each step needs the skip guard (`.claude/rules/preview-teardown.md:16`).
  - `neon-branch.sh delete` is at `:225-276`.
- **Guardrails.** `src/server/architecture.test.ts` has rules 1–5 (`:9-15`), a shrink-only `TODO` that is now empty (`:38-39`) and `ruleBroken` (`:67+`).
- **Scripts.**
  - `scripts/` holds bash only. Node is 24.x (`package.json:7-8`), which runs `.ts` directly.
  - `tsconfig.json` includes `**/*.ts` with `noEmit: true` but not `allowImportingTsExtensions`.
- **Agent docs.** `AGENTS.md:32-37` "Local Database" allows CRUD on a `local/<branch>` DB. Its Blob bullet (`:37`) warns that deleting a copied receipt deletes production's file, so delete only rows you made.

## Desired End State

- `BLOB_PATH_PREFIX` names the same branch as `DATABASE_URL`:
  - `local/<branch>/` locally on a branch
  - `preview/<branch>/` on a preview deploy
  - `""` on production and local `main`
  - A preview deploy without a `preview/` prefix fails at build.
- `VercelBlobStore` writes under the prefix, reads any pathname, and deletes only pathnames it owns. A non-owned delete is a silent no-op, so deleting an inherited Receipt on a branch removes the branch row and leaves production's file.
- Browser uploads land at `<prefix>receipts/upload/<name>-<suffix>`. A token request outside that path gets a 400, and a `receipt.create` whose `blobPathname` is outside it gets a `BAD_REQUEST`.
- Closing a PR, or running `make db_branch_delete`, empties the branch's prefix. The cleanup script refuses any prefix that isn't `local/…/` or `preview/…/`.
- Only `src/server/blob-store/` imports `@vercel/blob`, enforced by an architecture rule.
- adr028 records the decision (written 2026-10-10, Proposed until Phase 4 ships).

## Out of Scope

- **Separate stores per environment, or credential-level isolation.** Vercel has no read-only tokens, so a branch reading inherited files needs the production token anyway.
- **Copying production files into a branch.** Reads go straight through, and files never change.
- **Moving existing production files under a `production/` prefix.**
- **Old branch-written files at the store root** (uploads made before this plan). We can't tell them apart from production's.

## Approach

One store, with a pathname prefix per Neon branch, enforced in the adapter, which is the one place that writes and deletes. Services keep passing unprefixed keys (`receipts/email/…`) and store the prefixed pathname the adapter returns, so they never learn the environment. The prefix is set wherever `DATABASE_URL` is chosen (`neon-branch.sh`, `deploy.yml`), so the two can't drift.

**Precondition (met):** step 7 (`thoughts/plans/2026-10-07-trpc-3-tier-step-7-receipts.md`) shipped in PR #21 (`c462ff0`). Phase 2 builds on its `ReceiptsService.answerUpload` and `receipts.http.controller.ts`.

## Phase 1: Prefixed writes and own-only deletes

One commit: `feat(blob): prefix writes and own-only deletes per branch`, built by the TDD loop.

### Changes

- **`docs/adr/adr028-blob-files-branch-by-pathname-prefix.md`:** already written (Proposed, 2026-10-10, `/domain-model`). Set Status to `Accepted` and Date to the ship date in the commit that finishes Phase 4. If the code moves away from it, update the ADR in the same commit.
- **`src/server/blob-store/blob-prefix.ts`** (new; pure, no imports, so the Phase 4 script can load it):
  - `BRANCH_PREFIX = /^(local|preview)\/.+\/$/`
  - `isBranchPrefix(prefix)`
  - `owns(prefix, pathname)`: with a prefix, the pathname starts with it; with `""` (production), the pathname doesn't start with `local/` or `preview/`
- **`src/server/blob-store/blob-prefix.test.ts`:**
  - `owns`: own pathname yes; inherited production pathname no; another branch's no; production refuses `local/` and `preview/` pathnames
  - `isBranchPrefix`: rejects `""`, `local/`, `production/`, and a prefix with no trailing slash
- **`src/env.ts`:** add `BLOB_PATH_PREFIX` next to `:58`, plus `runtimeEnv` at `:148`.
  - Use `z.preprocess` like `:42-52`. `VERCEL_ENV === "production"` → `""`; otherwise the value or `""`.
  - Then `z.string().refine(p => p === "" || isBranchPrefix(p))`.
  - The rule that a preview needs a `preview/` prefix waits for Phase 3. `deploy.yml` doesn't set the prefix until then, so adding the rule now would fail this branch's own preview builds in Phases 1–2. Until Phase 3, a preview gets `""`, which is today's behaviour.
  - A JSDoc line says it names the same branch as `DATABASE_URL`.
- **`src/server/blob-store/blob-store.ts`:**
  - `constructor({ prefix }: { prefix: string })`
  - `write` puts at `prefix + pathname` and returns the store's (prefixed) pathname
  - `read` and `stream` are unchanged
  - `delete` returns without calling `del` unless `owns(prefix, pathname)`
  - Update the `BlobStore.write` and `delete` JSDoc at `:26` and `:32`: write keys under this environment's prefix; delete is a no-op for a file this environment doesn't own.
- **`src/server/blob-store/blob-store.test.ts`:**
  - existing cases use `{ prefix: "" }`
  - new: `write` with `local/b/` puts `local/b/receipts/x.png` and returns it
  - new: `delete` of an inherited `receipts/x.png` under `local/b/` never calls `del`
  - new: `delete` of `local/b/receipts/x.png` calls `del`
- **Wiring:** pass `new VercelBlobStore({ prefix: env.BLOB_PATH_PREFIX })` at `receipts.module.ts:21`, `functions.ts:29` and `inbound/route.ts:35`.
- **`src/server/architecture.test.ts`:**
  - rule 6, "a file outside `src/server/blob-store/` imports `@vercel/blob`"
  - exact specifier only, so `@vercel/blob/client` stays allowed in `receipt-upload.tsx:3` and in the type imports at `receipts.service.ts:1` and `receipts.http.controller.ts:1`
  - one `it` case for it, in the style of `:168-248`
  - no `TODO` entry: the list (`:39`) is empty, and the image route already reads through `BlobStore.stream`

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes with `BLOB_PATH_PREFIX` unset
- [x] `/security-review`: `src/env.ts` and the delete guard

## Phase 2: Browser uploads under the prefix

One commit: `feat(receipts): browser uploads land under the branch prefix`, built by the TDD loop.

### Changes

- **`src/server/errors/domain-errors.ts`:** new `InvalidInputError`, shaped like `NotFoundError` and `ConflictError`. It's a generic "the caller sent bad input" error, not a receipts one, so the next domain can reuse it.
- **`src/server/api/trpc.ts`:** `errorMappingMiddleware` (`:148-155`) maps `InvalidInputError` to `BAD_REQUEST`, next to the other two. Add a case to `trpc.test.ts`.
- **`.claude/rules/server-architecture.md`** "Errors": services throw `NotFoundError` / `ConflictError` / `InvalidInputError`, and the mapper turns `InvalidInputError` into `BAD_REQUEST`.
- **`ReceiptsService`** (`src/server/receipts/receipts.service.ts`):
  - new dep `uploadPathPrefix: string`
  - the `answerUpload` grant callback (`:253-261`) takes the `pathname` arg, and throws `InvalidInputError` unless `pathname.startsWith(uploadPathPrefix)`
  - the check runs after the member check, so signed-out still gives 401
  - `create` (`:119-134`) throws `InvalidInputError` unless `input.blobPathname.startsWith(uploadPathPrefix)`, before the insert. Without this, a client could make a row that points at another Receipt's file (for example `receipts/email/<uuid>.pdf`), and deleting that row in production would delete the other Receipt's file.
- **`receipts.service.test.ts`:**
  - grant: an in-prefix path returns the policy; an out-of-prefix path throws `InvalidInputError`
  - `create`: an in-prefix `blobPathname` inserts; an out-of-prefix one throws `InvalidInputError` and inserts nothing
- **`receipts.module.ts`:** wire `uploadPathPrefix: \`${env.BLOB_PATH_PREFIX}receipts/upload/\``.
- **`src/server/receipts/receipts.http.controller.ts`:** `failureStatus` (`:34-40`) maps `InvalidInputError` to 400, next to the 401 mapping. The 400 branch (`:169-174`) already logs a warn.
- **`receipts.http.controller.test.ts`:** a 400 case for the out-of-prefix token request.
- **`receipts.trpc.controller.test.ts`:** `create` throwing `InvalidInputError` comes back as `BAD_REQUEST`.
- **`src/app/(dashboard)/receipts/page.tsx:4-11`:** pass `uploadPrefix={\`${env.BLOB_PATH_PREFIX}receipts/upload/\`}` to `ReceiptsView`.
- **`receipts-view.tsx:78,112`:** take `uploadPrefix` and pass it to `ReceiptUpload`.
- **`receipt-upload.tsx:21,61`:** take `uploadPrefix` and upload as `` `${uploadPrefix}${ready.name}` ``.
- No visual change, so no `/design-review`.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes
- [x] Locally, with `BLOB_PATH_PREFIX="local/<branch>/"` set by hand: an upload at https://personal-finance.localhost/receipts mints, creates the row and extracts. The row's `blobPathname` (more-details panel) starts with `local/<branch>/receipts/upload/`.
  - 2026-10-10: mint, create and the image proxy read all work; pathname `local/feat/blob-branch-prefix/receipts/upload/prefix-test-receipt-….jpg`. A token and a `create` for `receipts/upload/evil.jpg` both 400. Extraction not seen: Bedrock refused an expired AWS session token (run `assume` before `make start`).
  - 2026-10-10: extraction from a prefixed pathname seen on the preview instead (Phase 3 below): Processed, $11.50.
- [x] `/security-review`: the upload grant and the `create` path check

## Phase 3: Set the prefix where the DB URL is set

One commit: `chore(blob): set the prefix in neon-branch.sh and the preview deploy`.

### Changes

- **`scripts/neon-branch.sh`:**
  - `apply_branch_urls` (`:130-139`) takes a second arg, the prefix, and writes `update_env_var "BLOB_PATH_PREFIX" "$prefix"`
  - a branch (`:217`) passes `"${PREFIX}/${git_branch}/"`, built from the full git branch name and not the 128-char cut `neon_branch_name` (`:184-188`). Blob has no 128 limit, and `teardown.yml` cleans by the full name, so the two always match.
  - `main` (`:177`) and the delete restore (`:273`) pass `""`
  - the log line names the prefix
- **`.github/workflows/deploy.yml:188-197`** (the "Vercel deploy" step):
  - when `ENVIRONMENT` is `preview`, add `--env "BLOB_PATH_PREFIX=preview/${GITHUB_REF_NAME}/" --build-env "BLOB_PATH_PREFIX=preview/${GITHUB_REF_NAME}/"`
  - comment: same source as the Neon `preview/<ref>` name at `:185-187`; build-env because `src/env.ts` validates at build
- **`src/env.ts`:** on `BLOB_PATH_PREFIX`, add the refine that `VERCEL_ENV === "preview"` needs a `preview/` prefix. It ships in the same commit as the `deploy.yml` change that sets the prefix, so every commit's preview builds.
- **`docs/README.md:24`:**
  - `BLOB_READ_WRITE_TOKEN` targets all environments (one store)
  - add a `BLOB_PATH_PREFIX` row: set by `neon-branch.sh` locally and by `deploy.yml` on preview; empty on production

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make db_branch` on a branch: `.env` gets `BLOB_PATH_PREFIX="local/<branch>/"`. Check with `make db_branch_status` and a grep on the key name only, never the value of a secret.
  - 2026-10-10: the script's log line now prints the prefix (`BLOB_PATH_PREFIX="local/feat/blob-branch-prefix/"`); status shows `*` on `local/feat/blob-branch-prefix`.
- [x] Run `make db_branch` in every live worktree (`git worktree list`). Worktrees made before this phase have a branch `DATABASE_URL` but no prefix, so they act like production and delete its files.
  - 2026-10-10: the only other worktree (`.claude/worktrees/trpc-step-3-plan`) has no directory left, just a stale lock from 2026-10-06. Nothing live to update.
- [x] A preview deploy of this branch builds. An upload on it lands under `preview/<branch>/receipts/upload/`.
  - 2026-10-10, local stand-in: `VERCEL_ENV=preview pnpm run build` fails on a `local/` prefix ("must be preview/<branch>/ on a preview deploy") and compiles with `BLOB_PATH_PREFIX=preview/feat/blob-branch-prefix/`.
  - 2026-10-10, real preview (`0bacb00`, `personal-finance-oivgn0wqa-rekurve.vercel.app`): built green. An upload minted and created (both 200), and a Blob `list` shows `preview/feat/blob-branch-prefix/receipts/upload/prefix-test-receipt-….jpg`. It extracted to Processed, $11.50.

## Phase 4: Teardown empties the prefix

One commit: `chore(blob): delete branch blobs on teardown`.

### Changes

- **`tsconfig.json`:** `"allowImportingTsExtensions": true`. This is legal with `noEmit: true` (`:20`), and Node 24's type stripping needs the `.ts` extension in imports.
- **`scripts/blob-prefix-delete.ts`** (new):
  - takes prefixes as args
  - exits non-zero unless each passes `isBranchPrefix` (imported from `../src/server/blob-store/blob-prefix.ts`). `local/` alone is allowed for `delete --all`, so the guard is `isBranchPrefix(p) || p === "local/" || p === "preview/"`.
  - then pages `list({ prefix, cursor })` and calls `del(urls)` per page
  - logs the count per prefix
  - the token comes from `BLOB_READ_WRITE_TOKEN`
- **`scripts/neon-branch.sh` `cmd_delete`** (`:225-276`):
  - **before** the Neon delete, run `BLOB_READ_WRITE_TOKEN="$(read_env_var BLOB_READ_WRITE_TOKEN)" node scripts/blob-prefix-delete.ts "local/<branch>/"` (or `"local/"` for `--all`)
  - run it even when the Neon branch is already gone, so it comes before the "Branch not found" `exit 0` (`:260-263`)
  - a blob failure aborts (`set -e`) and keeps the Neon branch, so a re-run retries both. With the old order, a re-run exited at "Branch not found" and the files were stuck.
  - skip with a log line when the token is empty
- **`.github/workflows/teardown.yml`:**
  - add a step "Delete branch blobs" **last**, after "Delete Vercel preview deployments". Removing the deployments first means no preview can upload after the cleanup.
  - `if: ${{ !cancelled() && steps.skip.outputs.skip != 'true' }}`, so a failed earlier step doesn't skip it. The script is idempotent, so re-runs are safe.
  - it does checkout, pnpm, setup-node and `make install` (mirror `deploy.yml:173-181`)
  - then `node scripts/blob-prefix-delete.ts "preview/<branch>/" "local/<branch>/"`
  - `env: BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}`
- **GitHub repo secret `BLOB_READ_WRITE_TOKEN`:** the operator adds it. The implementer asks the user to run `! gh secret set BLOB_READ_WRITE_TOKEN`.
  - Accepted: a second copy of the production token. `VERCEL_TOKEN` is already a repo secret and is stronger. Rotating the store token means updating both. A stale copy turns "Delete branch blobs" red, so drift is loud.
- **`.claude/rules/preview-teardown.md:14`:** the `local/` and `preview/` names now also prefix Blob pathnames (`neon-branch.sh`, `deploy.yml`, `teardown.yml`, `blob-prefix.ts`). Renaming one orphans files silently.
- **`AGENTS.md:37`:** replace the Blob warning. New files go under `local/<branch>/`, and deletes skip files outside it, so deleting any receipt on a branch is safe. Teardown (`make db_branch_delete`) empties the prefix.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `node scripts/blob-prefix-delete.ts receipts/` and `node scripts/blob-prefix-delete.ts ""` both exit non-zero without listing
  - 2026-10-10: `local/b/ receipts/` and no args refuse too.
- [x] Locally on a scratch branch:
  - upload a Receipt
  - `make db_branch_delete` logs one blob deleted for `local/<branch>/`
  - a `list` with that prefix is empty
  - 2026-10-10 on `scratch/blob-teardown`: two uploads under `local/scratch/blob-teardown/receipts/upload/`, one deleted in the UI. `make db_branch_delete` logged "deleted 1 blob(s)", then a re-run logged "deleted 0 blob(s)" and "Branch not found".
- [x] Closing a scratch PR runs "Delete branch blobs" green, and its log shows the `preview/<branch>/` count
  - 2026-10-10: no scratch PR. The `BLOB_READ_WRITE_TOKEN` repo secret is set. Check this when #46 merges: merging closes the PR, and the preview test upload means the log should show `preview/feat/blob-branch-prefix/: deleted 1 blob(s)` or more.
  - 2026-10-10: #46 merged. Run 38019325268 (`pull_request` closed): "Delete branch blobs" green, logged `preview/feat/blob-branch-prefix/: deleted 1 blob(s)` and `local/feat/blob-branch-prefix/: deleted 1 blob(s)`.
- [x] Locally on a branch at https://personal-finance.localhost/receipts:
  - deleting an inherited production Receipt removes the row, and its production `blobPathname` still answers `head`
  - deleting a Receipt uploaded on the branch removes its file
  - 2026-10-10: the second half holds. In the scratch run above, 2 uploads minus 1 UI delete left the 1 that teardown found.
  - 2026-10-10: the first half was checked by hand on the preview, not locally (same `owns` rule, `preview/` prefix): deleting an inherited production Receipt left its Blob object.

## References

- Ticket: none. This came from the step-7 Phase 4 browser check (2026-10-08).
- ADRs: `docs/adr/adr028-blob-files-branch-by-pathname-prefix.md` (written 2026-10-10 by `/domain-model`, Accepted 2026-10-10), implemented by Phases 1–4.
- Composes with: adr004 (adapter tier, `.claude/rules/server-architecture.md:32`), adr021 and adr022 via step 7.
- Prior plan: `thoughts/plans/2026-10-07-trpc-3-tier-step-7-receipts.md`. This plan depends on its Phase 5 (`:466-536`), now shipped.
- Vercel docs: https://vercel.com/docs/vercel-blob, https://vercel.com/docs/vercel-blob/using-blob-sdk, https://vercel.com/docs/vercel-blob/usage-and-pricing, https://vercel.com/docs/cli/deploy
- Related: `scripts/neon-branch.sh:17` (`PREFIX="local"`), `.github/workflows/teardown.yml:43-67`, `src/server/auth/config.ts:14-26`
