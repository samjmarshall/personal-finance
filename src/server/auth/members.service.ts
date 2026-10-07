import type { MembersRepository } from "./members.repository";

interface MembersServiceDeps {
	repository: MembersRepository;
}

// Named for the glossary's Member, not better-auth's `user` table.
export class MembersService {
	private readonly repository: MembersRepository;

	constructor({ repository }: MembersServiceDeps) {
		this.repository = repository;
	}

	// The batched lookup that replaces a cross-domain join (adr022): one call per
	// request, never per row. An id with no row has no entry.
	async namesByIds(memberIds: string[]): Promise<ReadonlyMap<string, string>> {
		const rows = memberIds.length
			? await this.repository.findNames(memberIds)
			: [];
		return new Map(rows.map(({ id, name }) => [id, name]));
	}
}
