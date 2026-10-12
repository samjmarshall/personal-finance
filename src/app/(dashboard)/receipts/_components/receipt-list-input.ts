import type { ReceiptStatus } from "~/lib/constants";

export type ListInput = {
	status: ReceiptStatus | undefined;
	unmatchedOnly: boolean;
};

type ListFilters = { status: ReceiptStatus | null; match: "all" | "unmatched" };

/** What the view opens on: every receipt. */
export const DEFAULT_FILTERS: ListFilters = { status: null, match: "all" };

/** Shared by the view and the page's prefetch, so the prefetch can't miss. */
export function toListInput({ status, match }: ListFilters): ListInput {
	return { status: status ?? undefined, unmatchedOnly: match === "unmatched" };
}
