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

	// Whole household's list, not just the caller's: a member should see an address
	// is taken before a duplicate add fails.
	async list(memberId: string): Promise<AllowedSenderListItem[]> {
		const rows = await this.repository.list();
		if (!rows.length) return [];
		const names = await this.members.namesByIds([
			...new Set(rows.map((row) => row.userId)),
		]);
		// Own-row flag set here: the client has no session to compare against.
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

	// Own entries only: deleting another member's address silently stops their
	// forwarded receipts, since a drop is only logged.
	async remove(memberId: string, id: number): Promise<void> {
		const row = await this.repository.deleteOwn(memberId, id);
		if (!row) throw new NotFoundError(NOT_YOURS_MESSAGE);
	}
}
