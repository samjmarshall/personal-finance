import type {
	CdrSetInBalanceInput,
	CdrSetNicknameInput,
	CdrSyncState,
} from "~/domain/cdr";
import { NotFoundError } from "~/server/errors/domain-errors";
import type { CdrRepository } from "./cdr.repository";

const UNKNOWN_ACCOUNT_MESSAGE =
	"That bank account isn't synced yet. Refresh and try again.";

interface CdrServiceDeps {
	repository: CdrRepository;
}

/** Serves tRPC; the sync worker is `CdrSyncService`, so this never needs RedBark. */
export class CdrService {
	private readonly repository: CdrRepository;

	constructor({ repository }: CdrServiceDeps) {
		this.repository = repository;
	}

	listSyncState(): Promise<CdrSyncState[]> {
		return this.repository.listSyncState();
	}

	/** The sync never overwrites this choice once set. */
	async setInBalance({
		accountId,
		inBalance,
	}: CdrSetInBalanceInput): Promise<CdrSyncState> {
		const row = await this.repository.setInBalance(accountId, inBalance);
		if (!row) throw new NotFoundError(UNKNOWN_ACCOUNT_MESSAGE);
		return row;
	}

	/** Null clears it, so the list shows the bank's name again. */
	async setNickname({
		accountId,
		nickname,
	}: CdrSetNicknameInput): Promise<CdrSyncState> {
		const row = await this.repository.setNickname(accountId, nickname);
		if (!row) throw new NotFoundError(UNKNOWN_ACCOUNT_MESSAGE);
		return row;
	}
}
