# tRPC routers to 3-tier: the router is the controller

Date: 2026-09-29
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr004 (refines it), adr002/adr003 (outbox), adr005 (schema homes)
Refines: adr004's cross-domain read allowance, its `*.router.ts` naming, and its
migration order (adr021, adr022)

## Problem

adr004 makes controller / service / repository the target shape for every server
entry point. Three domains follow it: `outbox/`, the receipts worker and the
email webhook. The nine tRPC routers in `src/server/api/routers/` do not. Each
procedure queries Drizzle through `ctx.db`, joins other domains' tables, and
throws `TRPCError` inline. About 1,200 lines mix transport, rules and SQL.

adr012 kept the plain-router shape for feature work. adr004 superseded it on
2026-09-09, so this design settles the shape of the migration, not whether to do it.

The session answered three questions:

- **Does tRPC need a controller class?** NestJS hides Express behind its
  controller layer. tRPC stays visible in every procedure, and something must
  turn a service's error into a `TRPCError`.
- **How does a procedure reach its service?**
- **May a domain read another domain's tables?** adr004 allows reads. That
  allowance has already drifted into a write allowance.

## Verified facts

tRPC 11.18.0, from source and docs:

- **Wrapping keeps the original.** A procedure that throws a non-`TRPCError`
  yields `INTERNAL_SERVER_ERROR` via `getTRPCErrorFromUnknown`, with the thrown
  value on `.cause`.
- **A middleware can remap.** After `const result = await next()`, a middleware
  can read `result.error` and throw a new `TRPCError` in its place. tRPC's own
  `outputValidatorMiddleware` does this.
- **Order.** In `.use(A).use(B)`, A wraps B and sees B's result.
- **`errorFormatter` cannot remap.** It runs at serialization and reshapes only
  the response body.
- **No official pattern.** The tRPC docs show try/catch per resolver only. A
  mapping middleware is supported, but it is our choice.

Repo:

- **adr004 already assigns mapping to the router.** It says "the router owns Zod
  parsing, auth and domain-error mapping … Services throw domain errors and
  never transport errors."
- **adr004 contradicts itself on order.** Its migration shape names
  `transactions/` "the reference router domain". Its implementation status says
  `receipts.ts` goes first, "as the last caller of the bound `commitWithOutbox`
  shim."
- **The rules file drifted.** `.claude/rules/server-architecture.md` (Schema
  homes) says "there is no cross-domain write ceremony — writes are direct db
  calls too." adr004 says cross-domain writes go through service ports only.
- **One cross-domain write is live.** `DrizzleEmailRepository.createPendingReceipts`
  inserts `receipts` rows through `outbox.commit`.
- **Cross-domain table reads exist in** five routers (`transaction`, `expense`,
  `receipts`, `cashflow`, `allowed-sender`), `receipts.repository.ts`
  (reads `expenseCategories`) and `src/app/api/receipts/[id]/image/route.ts`
  (queries `receipts`). `balance`, `income` and `setting` read only their own
  tables, but every router queries Drizzle directly.
- **No join filters, sorts or pages on a joined column.** The transaction list,
  for example, filters and sorts on `transactions` columns only. It selects
  `expenses.name` and `expenseCategories.name` for display.
- **Observability treats three codes as expected.** `observabilityMiddleware`
  tags `UNAUTHORIZED`, `FORBIDDEN` and `NOT_FOUND` and stops. Other codes fail
  the span, and 5xx codes also go to `reportError`. An unmapped `NotFoundError`
  would surface as a reported crash.
- **Copies exist.** `rethrowFkConflict` appears in both `transaction.ts` and
  `receipts.ts`. `cashflow.ts` repeats the consumption query from `expense.ts`.
- **Route files are composition roots.** `src/app/api/receipts/inbound/route.ts`
  imports `db` and `DrizzleEmailRepository` to build its tiers.

## Decisions

| #   | Question                                                       | Decision                                                                                                   |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Where does error-to-`TRPCError` mapping live?                  | The router is the controller. One error-mapping middleware. No controller class.                           |
| 2   | What shape do domain errors take?                              | Two shared classes, `NotFoundError` and `ConflictError`, in `src/server/errors/`. No tRPC import.          |
| 3   | Who turns a Postgres violation into a `ConflictError`?         | The service. The repository lets the driver error bubble.                                                  |
| 4   | How does a procedure reach its service?                        | `ctx.services`, built once in a tRPC composition root. Session values go in as arguments.                  |
| 5   | What ships first?                                              | The foundation plus transactions. Receipts goes last.                                                      |
| 6   | How many services per domain?                                  | One by default, split only when earned. Receipts and email qualify today.                                  |
| 7   | Are the Next.js route handlers in scope?                       | The receipts image and upload routes move in the receipts step. Health stays plain on purpose.             |
| 8   | How do composition roots share a service?                      | A module file for each service two or more roots need. Five after the migration.                           |
| 9   | Which folder does each router move into?                       | See the router map. Categories join expenses. Cashflow gets its own folder.                                |
| 10  | May a domain read another domain's tables?                     | No. It calls the owning service. An architecture test enforces this. Views are the recorded future option. |
| 11  | How do we break the transactions and expenses loop?            | Consumption moves to the transactions service.                                                             |
| 12  | Who owns member names?                                         | A members service in `src/server/auth/`.                                                                   |
| 13  | Where does the email ingest's receipt write go?                | The member-facing receipts service owns every pending receipt.                                             |
| 14  | When does the architecture test land?                          | In step 1, with a to-do list of known violations that can only shrink.                                     |
| 15  | What order do domains migrate in?                              | Transactions first. The to-do list covers the gap. Seven steps.                                            |
| 16  | What are controller files called?                              | `<domain>.<transport>.controller.ts`. Existing controllers are renamed to match.                           |
| 17  | How are tRPC controllers tested?                               | A thin test per controller, with fake services on the context.                                             |

Rejected alternatives worth remembering:

- **A controller class per domain (#1).** It cannot own `.input()` or the auth
  guard, which live on the procedure. The class would hold only try/catch.
- **Try/catch in every procedure (#1).** That is `rethrowFkConflict` copied
  across thirty procedures.
- **One error class per case (#2).** About fifteen classes, all mapped the same
  way. A domain earns a `*.errors.ts` when a caller must tell two failures apart
  by type. Nothing does today.
- **Result types (#2).** The 2026-08-24 error-parser design ruled them out as YAGNI.
- **A module file per domain (#4).** adr004 allows a module only for a second
  consumer, and router tests would need module mocking.
- **A router class that takes its service (#4).** It wraps every router in a
  class for no gain.
- **One server-wide service file (#8).** tRPC would load Bedrock to list transactions.
- **Keep direct reads and trust review (#10).** The rules file already drifted
  under review.

## Architecture

### The router is the controller

NestJS lent adr004 its tier names. Here is how they map onto tRPC:

| NestJS                      | tRPC                           |
| --------------------------- | ------------------------------ |
| `@Controller()` + `@Post()` | `createTRPCRouter({ … })`      |
| `ValidationPipe` on a DTO   | `.input(dto)`                  |
| `@UseGuards(AuthGuard)`     | `protectedProcedure`           |
| Global exception filter     | the error-mapping middleware   |
| Service                     | `<domain>.service.ts` class    |

A procedure parses input, checks auth and calls one service method. It holds no
rules, no Drizzle and no try/catch:

```ts
// src/server/email/allowed-sender.trpc.controller.ts
remove: protectedProcedure
	.input(allowedSenderRefDto)
	.mutation(({ ctx, input }) =>
		ctx.services.allowedSenders.remove(ctx.session.user.id, input.id),
	),
```

A tRPC controller exports a router object, not a class. tRPC builds the router,
so adr004's class rules apply from the service down.

A procedure may call any domain's service, but only one method.
`expense.consumption` calls the transactions service. tRPC paths describe what a
page asks for, and domain folders describe who owns the data. The two need not match.

### Tier files

| Tier       | File                                 | Job                                                                                                        |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Controller | `<domain>.<transport>.controller.ts` | A tRPC router, Inngest functions, or an HTTP `handle()`. Parse, auth, one service call.                   |
| Service    | `<domain>.service.ts`                | Rules and member-facing messages. Violations become `ConflictError`. Cross-domain reads go through other services. |
| Repository | `<domain>.repository.ts`             | Drizzle on the domain's own tables. No try/catch, no logging.                                              |
| Module     | `<domain>.module.ts`                 | Only when two or more composition roots need the same instance. Only roots and other modules import it.   |

A service types another domain's service as a narrow interface, such as a
`Pick` or a local port. A test fake is then an object literal with no cast,
matching adr004's port rule.

### Service split rule

Each domain gets one service. A domain earns a second only when:

- **its methods use disjoint dependency sets** (Seemann on constructor
  over-injection; the LCOM4 cohesion metric), or
- **a different caller or actor needs dependencies the others never use.**

Split on real pain, not in advance (Bogard). Two domains qualify today:

- **Receipts.** The worker service keeps extraction, with the language model,
  blob reads and the error reporter. It is renamed `ReceiptExtractionService`
  (`receipt-extraction.service.ts`) in step 6, matching `receipt-extraction.dto.ts`.
  A new member-facing service takes the domain name, `ReceiptsService`
  (`receipts.service.ts`), because it owns every Receipt row. It serves tRPC,
  the image route and the upload route, with the outbox, blob get and delete,
  and upload tokens. It takes over the upload route's size cap and file-type
  rules.
- **Email.** `EmailService` keeps webhook ingest, with the mailbox and blob
  store. A new `AllowedSenderService` (`allowed-sender.service.ts`) serves the
  allowlist controller and needs neither.

The rule goes into the rules file, so a split is a check rather than a matter of taste.

### Router map

| Router today       | Folder            | tRPC controller                    | Service                        |
| ------------------ | ----------------- | ---------------------------------- | ------------------------------ |
| `transaction.ts`   | `transactions/`   | `transactions.trpc.controller.ts`  | transactions                   |
| `expense.ts`       | `expenses/`       | `expenses.trpc.controller.ts`      | expenses                       |
| `category.ts`      | `expenses/`       | `categories.trpc.controller.ts`    | expenses                       |
| `income.ts`        | `income/`         | `income.trpc.controller.ts`        | income                         |
| `balance.ts`       | `balances/`       | `balances.trpc.controller.ts`      | balances                       |
| `setting.ts`       | `settings/`       | `settings.trpc.controller.ts`      | settings                       |
| `cashflow.ts`      | `cashflow/` (new) | `cashflow.trpc.controller.ts`      | cashflow (no repository)       |
| `allowed-sender.ts`| `email/`          | `allowed-sender.trpc.controller.ts`| `AllowedSenderService` (split) |
| `receipts.ts`      | `receipts/`       | `receipts.trpc.controller.ts`      | `ReceiptsService` (split)      |
| none               | `auth/`           | none                               | members                        |

- **Categories join expenses.** Their schema already lives there. Renaming a
  category rewrites `expenses.category` in one transaction. A separate categories
  domain would turn that into a cross-domain write. Both tables share the same
  dependencies, so the split rule gives one service. A Transaction links its
  Expense Category by id (`expenseCategoryId`), so a rename writes no
  `transactions` row. The text `transactions.category` is the Transaction's
  **Group** (see CONTEXT.md), owned by transactions, and a rename leaves it alone.
- **Cashflow owns no tables.** It calls five services and hands the results to
  the pure compute in `src/domain/cashflow/`, so it has no repository.
- **Procedure paths stay the same.** `root.ts` imports each router from its
  domain folder under the same key, so the client does not change.

### Dependency graph

Each domain calls only domains below it. The graph has no cycles.

| Level  | Domain                                                          | Calls                                                   |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------- |
| Bottom | expenses (with categories), members, income, balances, settings | nothing                                                 |
| Middle | transactions                                                    | expenses, for names                                     |
| Upper  | receipts (member-facing and worker)                             | members, transactions, expenses                         |
| Upper  | email (webhook and allowlist)                                   | receipts, for the pending write; members, for names     |
| Top    | cashflow                                                        | transactions, expenses, income, settings, balances      |

**Never add an upward call.** When a lower domain's page needs a higher domain's
data, the client asks both. Example: a receipt icon on the Transactions page.
Receipts sits above transactions, so the page calls `transaction.list` and a
batched `receipts.byTransactionIds(ids)`. `httpBatchStreamLink` sends both in one
HTTP request. A new top-level read service, like cashflow, is only for a real
composite view, not for one flag. The higher domain never grows a method that
returns the lower domain's list shape.

### Health stays plain

`src/app/api/health/route.ts` runs `select 1` and returns 200 or 503. It is a
system probe with no domain rules, so tiers would only pass calls through. The
architecture test lists it as a permanent, commented exemption so nobody "fixes" it.

## Wiring

### tRPC composition root

A new `src/server/api/services.ts` builds every service the routers need, once,
at module load. It calls `new` directly, or imports an instance from a module
file where one exists. `createTRPCContext` attaches the result:

```ts
return { db, session, services, ...opts };
```

The tRPC route and the RSC caller in `src/trpc/server.ts` both use
`createTRPCContext`, so both get the same instances. One `services` key keeps
service names clear of `session` and `headers`.

Services hold no per-request state. A procedure passes session values, such as
the member id, as method arguments. That keeps build-once safe and prepares for
household scoping.

- **Only where used.** A method takes `memberId` only if it reads it. Today that
  is the allowlist's list, add and remove, and receipts create. The rest take
  none. Household scoping adds its argument later, and the type checker finds
  every caller.
- **Named `memberId`.** The service boundary uses the glossary's word. The
  `userId` column keeps better-auth's name, and the repository maps between them.
- **`isOwn` moves into `AllowedSenderService`.** Comparing a row's owner with
  the member is a rule, not transport.

**Risk.** A service built at module load must not throw when an env var is
missing at build time. That is why the inbound route composes lazily:
`new Resend(undefined)` throws. Any tRPC-side service with the same problem
gets the same lazy memo.

### The context gets its own file

`createTRPCContext` moves out of `trpc.ts` into a new `src/server/api/context.ts`,
in step 1. `context.ts` imports `auth`, `db` (until step 7) and `services.ts`.
The tRPC route and `src/trpc/server.ts` import it from there.

`trpc.ts` keeps `t`, the middleware and the procedures. It takes the context
shape with `import type`, so at runtime it loads no `db`, no `auth` and no
services.

Why: every router test today mocks `~/server/db` and `~/server/auth`, only
because `trpc.ts` imports them. Leaving the context there would add a mock of
`services.ts` too. With the split, a controller test imports its controller,
builds `createCallerFactory(router)` with fakes on `ctx.services`, and needs no
`vi.mock`.

### Module files

**The rule.** A service gets a module file when two or more composition roots
need it. Only composition roots and other module files import a module file. A
module may import a lower domain's module, so the module graph follows the
dependency graph and stays acyclic. Each service is then built once per process.

Five exist after the migration:

- **`outbox.module.ts`** already exists. The Inngest cron, the repositories that
  write events, and the bound shim share it until step 6.
- **`receipts.module.ts`** is new in step 6. It builds the member-facing receipts
  service. The tRPC root, the image route, the upload route and the inbound route
  import it.
- **`transactions.module.ts`, `expenses.module.ts` and `members.module.ts`** are
  new in step 6. `receipts.module.ts` needs all three, and the Inngest root needs
  the expenses service for the worker's category read. Until then, only the tRPC
  root uses them, so `services.ts` calls `new` directly.

The Inngest root, `src/server/inngest/functions.ts`, still builds the worker
tiers. Each route file still builds its HTTP controller lazily in `compose()`, as
the inbound route does now.

Controller tests never load a module file. Only composition roots import them,
and a controller reaches its service through `ctx.services`.

### Renames in step 1

These go in their own commit:

| Today                             | After                                     | Class                       |
| --------------------------------- | ----------------------------------------- | --------------------------- |
| `receipts/receipts.controller.ts` | `receipts/receipts.inngest.controller.ts` | `ReceiptsInngestController` |
| `outbox/outbox.controller.ts`     | `outbox/outbox.inngest.controller.ts`     | `OutboxInngestController`   |
| `email/email.controller.ts`       | `email/email.http.controller.ts`          | `EmailHttpController`       |

Class names follow file names. Without that rule, the receipts folder would
hold two classes named `ReceiptsController`. Tests rename with them.
`registry-golden.test.ts`, `functions.ts` and the inbound route update their
imports. Inngest keys on function ids in code, never on file or class names, so
no wire string changes.

Why this pattern:

- **The domain prefix stays.** A bare `trpc.controller.ts` would repeat in eight
  folders, and sub-resources need a prefix anyway.
- **"Controller" stays at the end.** A transport-only suffix such as
  `receipts.inngest.ts` reads like an adapter file (`email.mailbox.ts`), and
  adr004 wants every file to name its tier.
- **Globs stay useful.** `*.controller.ts` finds every controller.
  `*.trpc.controller.ts` finds every router.

The receipts image and upload routes share one `receipts.http.controller.ts`,
with a method per route. Its class is `ReceiptsHttpController`. Each route file
stays its own composition root.

### Database handle

`ctx.db` stays until the last router migrates. Step 7 removes it, and
`context.ts` stops importing `db`. (`trpc.ts` stops in step 1, when the context moves out.)

## Errors

### The shared errors folder

The new `src/server/errors/` holds:

- **`NotFoundError` and `ConflictError`.** Each extends `Error` and takes the
  member-facing message plus an optional `{ cause }`.
- **`parse-error.ts` and `assert-row.ts`,** moved from `src/server/api/lib/`.
  `src/server/api/lib/` keeps re-exports for unmigrated routers until step 6
  deletes it.
- **One FK-conflict helper.** It replaces the two `rethrowFkConflict` copies and
  throws `ConflictError`.

None of these import tRPC, so Inngest workers can use them too.
`src/server/observability/errors/` stays the capture side, and the two folders
do not overlap.

`assertRow` now throws a plain `Error` instead of a `TRPCError`. The middleware
leaves unknown errors as `INTERNAL_SERVER_ERROR`, so the member sees the same result.

### Who does what

| Tier       | Job                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository | Lets the driver error bubble. No try/catch, per the existing rule.                                                                                                  |
| Service    | Catches it and checks `isPgViolation(error, PgViolation.X)`. Throws `ConflictError` with its own message and rethrows anything else. Throws `NotFoundError` on a missing row. |
| Middleware | Maps the class to a code. Keeps the message and the cause.                                                                                                          |

```ts
// allowlist service
async add(memberId: string, email: string): Promise<AllowedSender> {
	let row: AllowedSender | undefined;
	try {
		row = await this.repository.insert(memberId, email);
	} catch (error) {
		if (isPgViolation(error, PgViolation.UniqueViolation))
			throw new ConflictError("That address is already on the allowlist.", {
				cause: error,
			});
		throw error;
	}
	return assertRow(row, "add allowed sender");
}
```

The service owns the message, and the middleware owns only the code. That
answers the error-parser design's objection that "messages are contextual."

### The mapping middleware

```ts
const errorMappingMiddleware = t.middleware(async ({ next }) => {
	const result = await next();
	if (result.ok) return result;
	const { cause } = result.error;
	if (cause instanceof NotFoundError)
		throw new TRPCError({ code: "NOT_FOUND", message: cause.message, cause });
	if (cause instanceof ConflictError)
		throw new TRPCError({ code: "CONFLICT", message: cause.message, cause });
	return result;
});
```

- **Domain errors.** `NotFoundError` becomes `NOT_FOUND`, and `ConflictError`
  becomes `CONFLICT`.
- **Unknown errors** stay `INTERNAL_SERVER_ERROR`.
- **Deliberate `TRPCError`s pass through.** Examples are the auth check's
  `UNAUTHORIZED` and Zod's `BAD_REQUEST`. Neither carries a domain cause.

The chain runs in this order:

1. dev latency
2. observability
3. error mapping
4. auth, for `protectedProcedure` only

Observability wraps the mapper, so it sees the mapped code. A `NOT_FOUND` counts
as expected. A `CONFLICT` fails the span and logs a warning but is not reported
as a crash, as today. `publicProcedure` gets the mapper too.

**The member sees no change.** Every code and message matches today's. Only the
producer changes.

## Reading across domains

### The rule

A repository touches only its own domain's tables. Anything else goes through
the owning domain's service. Schema files still import each other for foreign
keys, because that is data definition, not data access. This withdraws adr004's
read-join allowance and fixes the rules-file drift.

### Replacing a join

A join becomes two steps. The domain runs its own query, then makes one batched
call to the other service, such as a lookup of names by id. The service merges
the results in memory. No call happens per row. Left-join behavior holds: a
missing id gives a null name.

| Read                     | Owner                  | Asks                                                |
| ------------------------ | ---------------------- | --------------------------------------------------- |
| Transaction list         | transactions           | expenses, for expense and category names            |
| Consumption per expense  | transactions           | nothing; it moved here from expenses                |
| Receipt list and detail  | member-facing receipts | members, transactions, expenses                     |
| Match candidates         | member-facing receipts | transactions, for the date window                   |
| Allowlist                | allowlist              | members, for names                                  |
| Worker category list     | receipts worker        | expenses                                            |
| Cashflow                 | cashflow               | transactions, expenses, income, settings, balances  |

### Consumption

**Consumed** (see CONTEXT.md) is a sum over transactions, so the transactions
service owns it as `consumedByExpense()`. `expense.consumption` keeps its path
and calls that method. Cashflow calls the same method, which removes the copied
query. **Remaining** stays where it is today: the Planned page and the cashflow
compute derive it from Consumed.

### Member names

`src/server/auth/members.service.ts` and `members.repository.ts` read only
better-auth's `user` table and offer one batched name lookup. The service takes
the glossary name, Member, not the library's table name.

### The email ingest's receipt write

The member-facing receipts service owns every pending receipt on every channel.
It gets an email-intake method next to upload create. `EmailService` calls it
through a small interface, which becomes its new dependency.
`DrizzleEmailRepository` drops `createPendingReceipts`, its `receipts.schema`
import and its outbox dependency. Event names such as `receipt/email.received`
stay byte-identical, because they are frozen wire strings.

### The architecture test

`src/server/architecture.test.ts` runs in Vitest and scans import specifiers
under `src/server/` and `src/app/`. It fails on any of these:

1. **Foreign tables.** A `*.service.ts` or `*.repository.ts` imports another
   domain's `*.schema.ts`.
2. **Foreign repositories.** A file outside a domain imports that domain's
   `*.repository.ts`. Composition roots are allowed: `src/server/api/services.ts`,
   `src/server/inngest/functions.ts`, `*.module.ts` and `route.ts` files.
3. **Data access in entry points.** A `*.controller.ts`, or any file in
   `src/server/api/routers/`, imports a `*.schema.ts`, `~/server/db` or
   `drizzle-orm`. A `route.ts` imports a `*.schema.ts` or `drizzle-orm`.
   Unmigrated routers count as entry points, or no rule would see them.
4. **Relational queries.** Any file uses Drizzle's `db.query.<table>` API. `db`
   carries every domain's tables (better-auth's adapter needs the merged
   schema), so `this.db.query.receipts.findMany()` would read a foreign table
   with no schema import. This is a text check, not an import check. Zero uses
   today, so it adds no to-do entries.

Raw `sql` that names another domain's table is a known gap. No rule catches it.

These files are exempt: `*.schema.ts` (for foreign keys), the
`src/server/db/index.ts` barrel, `*.test.ts`, and the health route.

**Refined while writing.** The approved wording banned `db` in route files too.
The inbound route imports `db` as a composition root, to pass into a repository
constructor, so a flat ban would flag correct code. Route files may import `db`
but never query with it. A query needs a table or `sql`, so the schema and
`drizzle-orm` checks catch it.

**The to-do list.** The test ships with today's violations in a list that can
only shrink. It fails on a violation missing from the list. It also fails on a
listed violation that no longer occurs, so the list stays honest. Each migration
step deletes its entries. Shopify's Packwerk works the same way.

The first entries are all nine routers in `src/server/api/routers/` (rule 3), the email
repository's `receipts.schema` import, the worker repository's
`categories.schema` import, and the image route.

### Future option: published views

A list that must filter, sort or page on another domain's column breaks the
in-memory merge. When that happens, the owning domain publishes a read-only
Postgres view that other domains may join. Milan Jovanović's version gives each
module its own Postgres schema, with GRANTs that limit each role to its own
tables and published views. That makes the boundary a database guarantee, and
it is the later hardening step.

Views cost something. They serve only reads, they add migrations and a second
shape to keep in sync, and they tie modules to one database. Nothing needs them today.

**Likely first trigger.** The transaction list filters and sorts by Group, its own
column. If Group is dropped, "sort by category" would sort on
`expenseCategories.name`, a foreign column. That is the first expected view.

## Testing

| Test                         | What it checks                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.trpc.controller.test.ts`  | Each procedure calls the right service method with the right arguments, especially the member id from the session. Built with `createTestCaller(router, { services, session })` and fakes on `ctx.services`. |
| `*.service.test.ts`          | Rules, messages, `ConflictError` on violations, `NotFoundError` cases. Object-literal fakes typed against the port interfaces.                                                         |
| `*.repository.test.ts`       | SQL text via `PgDialect` and write payloads, on a fake `db`. Never Postgres.                                                                                                             |
| `trpc.test.ts`               | The middleware, covering four cases below.                                                                                                                                              |
| `architecture.test.ts`       | The four rules and the to-do list.                                                                                                                                              |

**The test caller.** `src/server/api/test-caller.ts` exports
`createTestCaller(router, { services, session })`. It wraps
`createCallerFactory(router)` and fills in a default Member session for
`protectedProcedure`. Each fake is typed `Partial<TransactionsService>` and so
on. `Partial` keeps only public members, so a plain object fits with no cast,
and each fake method is checked against the real signature. The helper casts
once, inside itself. The Inngest and HTTP controller tests keep their casts; they
are out of scope.

The middleware cases:

- **Not found.** `NotFoundError` becomes `NOT_FOUND` and keeps its message and cause.
- **Conflict.** `ConflictError` becomes `CONFLICT` the same way.
- **Unknown.** Any other error stays `INTERNAL_SERVER_ERROR`.
- **Pass-through.** A thrown `TRPCError` is untouched.

A fifth check confirms observability sees the mapped code, so a `NOT_FOUND` no
longer fails the span.

Today's router tests (`allowed-sender`, `setting` and the four `receipts.*`
files) split downward. Behavior checks move into service tests, and SQL checks
move into repository tests. The allowlist's own-entries-only `remove` keeps a
controller test. The type checker cannot catch a wrong id being passed, and this
is a security rule.

## Migration

Each step is one change, green before and after, and never mixed into a feature diff.

1. **Foundation plus transactions.** Ship `src/server/errors/`, the moved
   helpers, the mapping middleware, `ctx.services`, the tRPC root, `context.ts`,
   the test caller, the architecture test with its to-do list, and the controller renames in their
   own commit. Transactions migrates, including consumption. The expense-name
   join in the transaction list stays on the to-do list. Fix the rules-file
   write-drift line.
2. **Expenses and categories.** The transaction list switches to the expenses
   service lookup, which clears its to-do entry. `expense.consumption` calls the
   transactions service.
3. **Income, then balances, then settings.** One change each.
4. **Members, then the allowlist.**
5. **Cashflow.** Create the folder. It calls five services and drops the copied
   consumption query.
6. **Receipts.** Rename the worker service to `ReceiptExtractionService` in its
   own commit. Ship the member-facing `ReceiptsService`, `receipts.module.ts`,
   `receipts.trpc.controller.ts`, and `receipts.http.controller.ts` for the
   image and upload routes. Add `transactions.module.ts`, `expenses.module.ts`
   and `members.module.ts`, and switch `services.ts` to import from them. Move the email write. Put the worker's category read
   behind the expenses service. Retire the bound `commitWithOutbox` shim and
   delete `src/server/api/lib/`.
7. **Cleanup.** Remove `ctx.db`. The to-do list must be empty, with health still
   exempt, and `src/server/api/routers/` must be gone. Rewrite the rules file's "tRPC routers (not yet migrated)" section.

## Documentation changes

- **Step 1 fixes the rules file.** It corrects the line that calls cross-domain
  writes direct db calls. It also updates the tier map for the new controller
  names and adds the service split rule and the cross-domain rule.
- **A new ADR refines adr004.** It withdraws the read-join allowance, replaces
  `*.router.ts` with `<domain>.trpc.controller.ts`, and settles the order
  contradiction as transactions first.
- **Step 6 updates `bedrock-invocation.md`** and the rules file's reference
  implementations for the `ReceiptExtractionService` rename.
- **Step 7 rewrites the rules file's router section.**

## Out of scope

- Per-domain error classes, result types and `errorFormatter` changes.
- Published views and Postgres GRANTs, recorded above as future options.
- Tiers for the health route.
- Household scoping. Passing session values as arguments prepares for it but
  does not add it.
- Any tRPC path or client change.

## Sources

tRPC mechanics:

- [procedureBuilder.ts](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/procedureBuilder.ts): `callRecursive`, `getTRPCErrorFromUnknown`
- [middleware.ts](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/middleware.ts): the `outputValidatorMiddleware` remap pattern
- [error-handling.md](https://github.com/trpc/trpc/blob/main/www/docs/server/error-handling.md) and [error-formatting.md](https://github.com/trpc/trpc/blob/main/www/docs/server/error-formatting.md)

Service granularity:

- [Seemann, On Constructor Over-injection](https://blog.ploeh.dk/2018/08/27/on-constructor-over-injection/) and [Refactoring to Aggregate Services](https://blog.ploeh.dk/2010/02/02/RefactoringtoAggregateServices/)
- [LCOM4 cohesion](https://objectscriptquality.com/docs/metrics/lack-cohesion-methods-lcom4)
- [Microsoft, CQRS application layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-application-layer-implementation-web-api)
- [Bogard, Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
- [NestJS modules](https://docs.nestjs.com/modules)
- [Fowler, Service Layer](https://martinfowler.com/eaaCatalog/serviceLayer.html)

Cross-domain data:

- [Jovanović, Modular monolith data isolation](https://milanjovanovic.tech/blog/modular-monolith-data-isolation) and [Keeping data boundaries intact](https://www.milanjovanovic.tech/blog/how-to-keep-your-data-boundaries-intact-in-a-modular-monolith)
- [Grzybek, modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd) and [Integration styles](https://www.kamilgrzybek.com/blog/posts/modular-monolith-integration-styles)
- [Simon Brown, Modular monolith](https://simonbrown.je/modular-monolith/)
- [Shopify, Under Deconstruction](https://shopify.engineering/shopify-monolith)
- [Richardson, Database per service](https://microservices.io/patterns/data/database-per-service.html)
- [Notes on Newman, Monolith to Microservices](https://eddmann.com/posts/notes-monolith-to-microservices-by-sam-newman/) (secondhand summary of the view pattern)

Research gaps: Evans, Khononov and Uncle Bob were not read. Newman was read only
secondhand. No primary source covered the cost of in-memory joins.

## Related ADRs

- [adr021](../../docs/adr/adr021-trpc-router-is-the-controller-tier.md) — the tRPC router is the controller tier (candidates 1 and 4)
- [adr022](../../docs/adr/adr022-cross-domain-data-through-the-owning-service.md) — cross-domain data goes through the owning service only (candidate 2)
- Candidate 3 (service split rule) was not made an ADR: a split is a local refactor, so it fails "hard to reverse". The rule goes in the rules file.
- [adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md) is refined by links and tags, not rewritten.
