import { z } from "zod";
import { CdrConnectionStatus } from "~/lib/constants";

/**
 * The slice of RedBark's v2 API (version `2026-10-01.wattle`) the sync reads.
 * Bodies cross the network, so each is parsed; non-strict, so a field RedBark
 * adds later can't fail the parse.
 */

/** Integer minor units (cents); `currency` is lowercase ISO 4217. */
const redbarkMoneyDto = z.object({
	amount: z.number().int(),
	currency: z.string(),
});

export const redbarkTransactionDto = z.object({
	id: z.string(),
	account: z.string(),
	/** Local calendar date, `YYYY-MM-DD`. */
	date: z.iso.date(),
	description: z.string(),
	amount: redbarkMoneyDto.nullable(),
	direction: z.enum(["debit", "credit"]).nullish(),
	status: z.string().nullish(),
});

export const redbarkAccountDto = z.object({
	id: z.string(),
	connection: z.string(),
	name: z.string(),
	status: z.enum(["available", "syncing", "unavailable"]),
});

export const redbarkConnectionDto = z.object({
	id: z.string(),
	status: z.enum(CdrConnectionStatus),
});

export const redbarkBalanceDto = z.object({
	account: z.string(),
	current: redbarkMoneyDto.nullable(),
	freshness: z.enum(["fresh", "stale", "unavailable"]).nullable(),
	observed_at: z.iso.datetime({ offset: true }).nullable(),
});

/** `next_page_url` is absolute; null on the last page. */
export const redbarkPageDto = <T extends z.ZodType>(item: T) =>
	z.object({
		data: z.array(item),
		next_page_url: z.url().nullable(),
	});

export type RedbarkTransaction = z.infer<typeof redbarkTransactionDto>;
export type RedbarkAccount = z.infer<typeof redbarkAccountDto>;
export type RedbarkConnection = z.infer<typeof redbarkConnectionDto>;
export type RedbarkBalance = z.infer<typeof redbarkBalanceDto>;
