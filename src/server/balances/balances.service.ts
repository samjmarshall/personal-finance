import type { BalanceSetInput, BalanceSnapshot } from "~/domain/balances";
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
		return assertRow(await this.repository.insert(input), "set balance");
	}
}
