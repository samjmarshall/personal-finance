import type { BalanceSetInput, BalanceSnapshot } from "~/domain/balances";
import { BalanceSource } from "~/lib/constants";
import { assertRow } from "~/server/errors/assert-row";
import type { BalancesRepository } from "./balances.repository";

interface BalancesServiceDeps {
	repository: BalancesRepository;
}

export class BalancesService {
	private readonly repository: BalancesRepository;

	constructor({ repository }: BalancesServiceDeps) {
		this.repository = repository;
	}

	async latest(): Promise<BalanceSnapshot | null> {
		return (await this.repository.findLatest()) ?? null;
	}

	// Records a new snapshot — history is kept, latest wins. Never an in-place edit.
	async set(input: BalanceSetInput): Promise<BalanceSnapshot> {
		return assertRow(
			await this.repository.insert({ ...input, source: BalanceSource.Manual }),
			"set balance",
		);
	}

	// The bank sync's anchor. Same latest-wins rule as a typed balance (adr017 facet 6).
	async recordSynced(input: BalanceSetInput): Promise<BalanceSnapshot> {
		return assertRow(
			await this.repository.insert({ ...input, source: BalanceSource.Cdr }),
			"record synced balance",
		);
	}
}
