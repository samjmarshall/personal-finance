import { TRPCError } from "@trpc/server";
import { asc, eq, getTableColumns } from "drizzle-orm";

import {
	type AllowedSender,
	type AllowedSenderListItem,
	allowedSenderCreateDto,
	allowedSenderRefDto,
} from "~/domain/receipts";
import { assertRow } from "~/server/api/lib/assert-row";
import { isPgError } from "~/server/api/lib/pg-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/auth/auth.schema";
import { allowedSenders } from "~/server/receipts/allowed-sender.schema";

export const allowedSenderRouter = createTRPCRouter({
	// The whole allowlist, not just the caller's: it is household config, and a member
	// needs to see an address is already claimed before the CONFLICT tells them so.
	list: protectedProcedure.query(
		async ({ ctx }): Promise<AllowedSenderListItem[]> => {
			return ctx.db
				.select({ ...getTableColumns(allowedSenders), userName: user.name })
				.from(allowedSenders)
				.leftJoin(user, eq(allowedSenders.userId, user.id))
				.orderBy(asc(allowedSenders.email));
		},
	),

	// Members self-register the address they forward from. Ownership is server-set
	// from the session — a client-supplied userId would let anyone route someone
	// else's mail into their own name.
	add: protectedProcedure
		.input(allowedSenderCreateDto)
		.mutation(async ({ ctx, input }): Promise<AllowedSender> => {
			let row: AllowedSender | undefined;
			try {
				[row] = await ctx.db
					.insert(allowedSenders)
					.values({ email: input.email, userId: ctx.session.user.id })
					.returning();
			} catch (error) {
				// One address maps to one Member, so a re-add (in any casing — the DTO
				// normalised it) trips the unique index. Say so rather than 500.
				if (isPgError(error, "23505"))
					throw new TRPCError({
						code: "CONFLICT",
						message: "That address is already on the allowlist.",
					});
				throw error;
			}
			return assertRow(row, "add allowed sender");
		}),

	remove: protectedProcedure
		.input(allowedSenderRefDto)
		.mutation(async ({ ctx, input }) => {
			// Delete-or-404 in one statement, per the receipt router.
			const [row] = await ctx.db
				.delete(allowedSenders)
				.where(eq(allowedSenders.id, input.id))
				.returning({ id: allowedSenders.id });
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "That address is not on the allowlist.",
				});
			return { success: true };
		}),
});
