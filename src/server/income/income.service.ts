import type {
	Income,
	IncomeCreateInput,
	IncomeUpdateInput,
} from "~/domain/income";
import { assertRow } from "~/server/errors/assert-row";
import type { IncomeRepository } from "./income.repository";

interface IncomeServiceDeps {
	repository: IncomeRepository;
}

export class IncomeService {
	private readonly repository: IncomeRepository;

	constructor({ repository }: IncomeServiceDeps) {
		this.repository = repository;
	}

	list(): Promise<Income[]> {
		return this.repository.list();
	}

	async create(input: IncomeCreateInput): Promise<Income> {
		return assertRow(await this.repository.insert(input), "create income");
	}

	// Missing id stays a 500, not "not found", to keep what members already see.
	async update({ id, ...values }: IncomeUpdateInput): Promise<Income> {
		return assertRow(await this.repository.update(id, values), "update income");
	}

	delete(id: number): Promise<void> {
		return this.repository.delete(id);
	}
}
