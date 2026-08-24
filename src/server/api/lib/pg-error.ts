// postgres.js raises a PostgresError carrying the SQLSTATE code (e.g. 23503 =
// foreign_key_violation, 23505 = unique_violation).
export function isPgError(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === code
	);
}
