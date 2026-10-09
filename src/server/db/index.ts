import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as allowedSendersSchema from "~/server/allowed-senders/allowed-senders.schema";
import * as authSchema from "~/server/auth/auth.schema";
import * as balancesSchema from "~/server/balances/balances.schema";
import * as categoriesSchema from "~/server/categories/categories.schema";
import * as expensesSchema from "~/server/expenses/expenses.schema";
import * as incomeSchema from "~/server/income/income.schema";
import * as outboxSchema from "~/server/outbox/outbox.schema";
import * as receiptsSchema from "~/server/receipts/receipts.schema";
import * as settingsSchema from "~/server/settings/settings.schema";
import * as transactionsSchema from "~/server/transactions/transactions.schema";

/** Merged table set backing `db.query.*`; every domain schema module must appear here. */
const schema = {
	...allowedSendersSchema,
	...balancesSchema,
	...categoriesSchema,
	...expensesSchema,
	...incomeSchema,
	...outboxSchema,
	...receiptsSchema,
	...settingsSchema,
	...transactionsSchema,
	...authSchema,
};

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
	conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL);
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
