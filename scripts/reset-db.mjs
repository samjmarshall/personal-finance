// One-time reset for the adr005 prefix retirement: drops the pushed tables so
// `yarn db:migrate` can apply the 0000 baseline against a clean database.
//
// DESTRUCTIVE. Financial data is reseeded by scripts/seed.mjs from
// docs/budget.xlsx; better-auth accounts and sessions are NOT recoverable.
//
// Run: node scripts/reset-db.mjs

import postgres from "postgres";

// Load the env file directly rather than via `source` — values containing `&`
// break shell sourcing. Same approach drizzle-kit takes.
if (!process.env.DATABASE_URL) process.loadEnvFile();

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Old prefixed domain tables, plus the better-auth set. CASCADE clears the FKs.
const TABLES = [
	"pg-drizzle_expense",
	"pg-drizzle_income",
	"pg-drizzle_post",
	"pg-drizzle_transaction",
	"expense",
	"income",
	"transaction",
	"account",
	"session",
	"verification",
	"user",
];

const before = await sql`
	select table_name from information_schema.tables
	where table_schema = 'public'
	order by table_name`;
console.log(
	"public tables before:",
	before.map((r) => r.table_name),
);

await sql.begin(async (tx) => {
	const list = TABLES.map((t) => `"${t}"`).join(", ");
	await tx.unsafe(`DROP TABLE IF EXISTS ${list} CASCADE`);
	// Any partial __drizzle_migrations row would make migrate skip the baseline
	// and leave the database empty.
	await tx.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
});

const after = await sql`
	select table_name from information_schema.tables
	where table_schema = 'public'
	order by table_name`;
console.log(
	"public tables after:",
	after.map((r) => r.table_name),
);

await sql.end();
