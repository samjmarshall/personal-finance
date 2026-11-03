import { toDateInput } from "~/lib/utils";

// Parsing the day gives local midnight, but a synced row is saved at UTC midnight.
// Resend the saved date when the day is untouched: the server refuses a changed one.
export function submittedDate(input: string, saved: Date | undefined): Date {
	if (saved && input === toDateInput(saved)) return saved;

	return new Date(`${input}T00:00:00`);
}
