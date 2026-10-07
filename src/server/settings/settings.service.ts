import { fromDateInput } from "~/lib/utils";
import { assertRow } from "~/server/errors/assert-row";
import { FORTNIGHT_ANCHOR_KEY } from "./settings.constants";
import type { SettingsRepository } from "./settings.repository";

interface SettingsServiceDeps {
	repository: SettingsRepository;
}

export class SettingsService {
	private readonly repository: SettingsRepository;

	constructor({ repository }: SettingsServiceDeps) {
		this.repository = repository;
	}

	// A YYYY-MM-DD string, not a Date: a Date goes over the wire as UTC and reads a
	// day early behind UTC. null when unset or invalid, so pickers fall back to month.
	async fortnightAnchor(): Promise<string | null> {
		const value = await this.repository.findValue(FORTNIGHT_ANCHOR_KEY);
		return value && fromDateInput(value) ? value : null;
	}

	// Upsert, not insert: a migration already seeded the row. Returns a string for
	// the same timezone reason as the read.
	async setFortnightAnchor(anchor: string): Promise<string> {
		const row = await this.repository.upsert(FORTNIGHT_ANCHOR_KEY, anchor);
		return assertRow(row, "set fortnight anchor").value;
	}
}
