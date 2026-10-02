import { drizzle } from "drizzle-orm/pg-proxy";

// Test stand-in for ./index: a real drizzle db over pg-proxy, so queries render
// through the real PgDialect and driver errors come back wrapped in
// DrizzleQueryError exactly as in production. Never touches Postgres.

export type RecordedQuery = {
	sql: string;
	params: unknown[];
	method: "all" | "execute";
};

// Rows are arrays in select-field order (pg-proxy "all" mode). Match on
// `query.sql`, not call order: `Promise.all` callers don't promise an order.
export type Respond = (query: RecordedQuery) => unknown[][] | Error;

export function recordingDb(respond: Respond = () => []) {
	const queries: RecordedQuery[] = [];
	const record = (sql: string) =>
		queries.push({ sql, params: [], method: "execute" });
	const db = drizzle(async (sql, params, method) => {
		const query = { sql, params, method };
		queries.push(query);
		const response = respond(query);
		if (response instanceof Error) throw response;
		return { rows: response };
	});
	// pg-proxy's own transaction throws (pg-proxy/session.js:35-37), so run the
	// callback over this same db. Fine while nothing here nests transactions.
	db.transaction = async (transaction) => {
		record("begin");
		try {
			const result = await transaction(db as never);
			record("commit");
			return result;
		} catch (error) {
			record("rollback");
			throw error;
		}
	};
	return { db, queries };
}

// A postgres.js-shaped driver error; pg-proxy hangs it off `.cause` of the
// DrizzleQueryError it throws, the hop parse-error.ts unwraps.
export function pgError(code: string): Error {
	return Object.assign(new Error(`postgres error ${code}`), { code });
}
