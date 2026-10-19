import { toDateInput } from "~/lib/utils";

// The date input holds only a day, and parsing it gives local midnight. A
// synced row is stored at UTC midnight, so re-sending an untouched day would
// post a new instant, and the server refuses a changed date on a synced row.
export function submittedDate(input: string, saved: Date | undefined): Date {
	if (saved && input === toDateInput(saved)) return saved;
	return new Date(`${input}T00:00:00`);
}
