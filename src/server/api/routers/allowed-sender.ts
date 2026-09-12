import { TRPCError } from "@trpc/server";
import { and, asc, eq, getTableColumns } from "drizzle-orm";

import {
	type AllowedSender,
	type AllowedSenderListItem,
	allowedSenderCreateDto,
	allowedSenderRefDto,
} from "~/domain/email";
import { assertRow } from "~/server/api/lib/assert-row";
import { PgViolation, parseError } from "~/server/api/lib/parse-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/auth/auth.schema";
import { allowedSenders } from "~/server/email/allowed-sender.schema";

export const allowedSenderRouter = createTRPCRouter({
	// The whole allowlist, not just the caller's: it is household config, and a member
	// needs to see an address is already claimed before the CONFLICT tells them so.
	list: protectedProcedure.query(
		async ({ ctx }): Promise<AllowedSenderListItem[]> => {
			const rows = await ctx.db
				.select({ ...getTableColumns(allowedSenders), userName: user.name })
				.from(allowedSenders)
				.leftJoin(user, eq(allowedSenders.userId, user.id))
				.orderBy(asc(allowedSenders.email));
			// Derived here rather than compared in the client, which has no session.
			return rows.map((row) => ({
				...row,
				isOwn: row.userId === ctx.session.user.id,
			}));
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
				const parsed = parseError(error);
				if (
					parsed.kind === "pg" &&
					parsed.violation === PgViolation.UniqueViolation
				)
					throw new TRPCError({
						code: "CONFLICT",
						message: "That address is already on the allowlist.",
						cause: error,
					});
				throw error;
			}
			return assertRow(row, "add allowed sender");
		}),

	// Scoped to the caller's own entries, unlike `list`. Removing someone else's
	// address silently stops their forwarded receipts arriving — the webhook only
	// logs a drop — so the blast radius is another member's data quietly going
	// missing. Seeing the whole allowlist is useful; editing it is not.
	remove: protectedProcedure
		.input(allowedSenderRefDto)
		.mutation(async ({ ctx, input }) => {
			// Delete-or-404 in one statement, per the receipt router. Another member's
			// id matches no row under this filter and so 404s, which also keeps the
			// response identical whether it is absent or merely not theirs.
			const [row] = await ctx.db
				.delete(allowedSenders)
				.where(
					and(
						eq(allowedSenders.id, input.id),
						eq(allowedSenders.userId, ctx.session.user.id),
					),
				)
				.returning({ id: allowedSenders.id });
			if (!row)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "That address is not on your allowlist.",
				});
			return { success: true };
		}),
});
