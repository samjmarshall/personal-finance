/**
 * Settled RedBark v2 transaction rows for tests. Made-up values, real field
 * shape: the 2026-10-16 live spike saw these fields and this sign rule (adr017
 * facet 4). Real bank rows stay out of this public repo.
 */
export const debitRow = {
	id: "txn_debit",
	object: "transaction",
	account: "acct_1",
	status: "posted",
	date: "2026-10-01",
	description: "WOOLWORTHS 1234 SYDNEY",
	amount: { amount: -4250, currency: "aud" },
	direction: "debit",
	livemode: true,
};

export const creditRow = {
	id: "txn_credit",
	object: "transaction",
	account: "acct_1",
	status: "posted",
	date: "2026-10-02",
	description: "SALARY ACME PTY LTD",
	amount: { amount: 250000, currency: "aud" },
	direction: "credit",
	livemode: true,
};
