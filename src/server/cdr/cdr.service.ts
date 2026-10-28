import {
	type CdrImport,
	type CdrImportStartInput,
	type CdrSetInBalanceInput,
	type CdrSetNicknameInput,
	type CdrSyncState,
	IMPORT_MAX_YEARS,
	importEarliestDay,
	type LatestImport,
} from "~/domain/cdr";
import { CdrImportStatus, HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import { dayKeyInZone } from "~/lib/utils";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import type { CdrRepository } from "./cdr.repository";

// A queued or running import older than this is taken as dead: a cancelled run,
// or one whose failure never got saved, would otherwise block every later import.
const IMPORT_ACTIVE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

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

	/** Refuses a bad range or a second active import. Days are inclusive, in the household's zone. */
	async startImport({ from, to }: CdrImportStartInput): Promise<CdrImport> {
		const today = dayKeyInZone(new Date(), HOUSEHOLD_TIME_ZONE);
		if (from > to)
			throw new InvalidInputError(
				"The From day must be on or before the To day.",
			);
		if (to > today)
			throw new InvalidInputError("The To day can't be after today.");
		if (from < importEarliestDay(today))
			throw new InvalidInputError(
				`An import can reach back ${IMPORT_MAX_YEARS} years at most.`,
			);
		if (await this.repository.findActiveImport(activeSince()))
			throw new ConflictError("An import is already running.");
		return this.repository.insertImport({
			fromDate: utcMidnight(from),
			toDate: utcMidnight(to),
		});
	}

	/** Null before the first import. */
	async latestImport(): Promise<LatestImport | null> {
		const row = await this.repository.latestImport();
		if (!row) return null;
		const unfinished =
			row.status === CdrImportStatus.Queued ||
			row.status === CdrImportStatus.Running;
		return { ...row, active: unfinished && row.createdAt > activeSince() };
	}
}

const activeSince = () => new Date(Date.now() - IMPORT_ACTIVE_HOURS * HOUR_MS);

const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);
