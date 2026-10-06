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

	// The household payday (YYYY-MM-DD) that seeds fortnight windows. A string,
	// not a Date: a Date crosses the wire as a UTC instant, and behind-UTC
	// browsers read it a day early. null when unseeded or malformed, so the
	// Unplanned picker falls back to month-only instead of erroring.
	async fortnightAnchor(): Promise<string | null> {
		const value = await this.repository.findValue(FORTNIGHT_ANCHOR_KEY);
		return value && fromDateInput(value) ? value : null;
	}

	// Upsert, not insert: the seed migration already planted the row. Returns a
	// string for the same wire reason as fortnightAnchor.
	async setFortnightAnchor(anchor: string): Promise<string> {
		const row = await this.repository.upsert(FORTNIGHT_ANCHOR_KEY, anchor);
		return assertRow(row, "set fortnight anchor").value;
	}
}
