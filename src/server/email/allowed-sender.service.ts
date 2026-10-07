import type { AllowedSender, AllowedSenderListItem } from "~/domain/email";
import type { MembersService } from "~/server/auth/members.service";
import { assertRow } from "~/server/errors/assert-row";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type { AllowedSenderRepository } from "./allowed-sender.repository";

const ALREADY_ALLOWED_MESSAGE = "That address is already on the allowlist.";
const NOT_YOURS_MESSAGE = "That address is not on your allowlist.";

interface AllowedSenderServiceDeps {
	repository: AllowedSenderRepository;
	members: Pick<MembersService, "namesByIds">;
}

export class AllowedSenderService {
	private readonly repository: AllowedSenderRepository;
	private readonly members: Pick<MembersService, "namesByIds">;

	constructor({ repository, members }: AllowedSenderServiceDeps) {
		this.repository = repository;
		this.members = members;
	}

	// The whole allowlist, not just the caller's: it is household config, and a member
	// needs to see an address is already claimed before the CONFLICT tells them so.
	async list(memberId: string): Promise<AllowedSenderListItem[]> {
		const rows = await this.repository.list();
		if (!rows.length) return [];
		const names = await this.members.namesByIds([
			...new Set(rows.map((row) => row.userId)),
		]);
		// isOwn is derived here rather than compared in the client, which has no session.
		return rows.map((row) => ({
			...row,
			userName: names.get(row.userId) ?? null,
			isOwn: row.userId === memberId,
		}));
	}

	async add(memberId: string, email: string): Promise<AllowedSender> {
		let row: AllowedSender | undefined;
		try {
			row = await this.repository.insert(memberId, email);
		} catch (error) {
			// One address maps to one Member, so a re-add (in any casing — the DTO
			// normalised it) trips the unique index. Say so rather than 500.
			if (isPgViolation(error, PgViolation.UniqueViolation))
				throw new ConflictError(ALREADY_ALLOWED_MESSAGE, { cause: error });
			throw error;
		}
		return assertRow(row, "add allowed sender");
	}

	// Scoped to the caller's own entries, unlike `list`. Removing someone else's
	// address silently stops their forwarded receipts arriving — the webhook only
	// logs a drop — so the blast radius is another member's data quietly going
	// missing. Seeing the whole allowlist is useful; editing it is not.
	async remove(memberId: string, id: number): Promise<void> {
		const row = await this.repository.deleteOwn(memberId, id);
		if (!row) throw new NotFoundError(NOT_YOURS_MESSAGE);
	}
}
