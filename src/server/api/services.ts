import { db } from "~/server/db";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";

// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {
	transactions: new TransactionsService({
		repository: new DrizzleTransactionsRepository({ db }),
	}),
};

export type Services = typeof services;
