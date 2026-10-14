import type { ReceiptStatus } from "~/lib/constants";
import type { RouterInputs } from "~/trpc/react";

// Input is optional on the server, so drop the "no input" case.
export type ListInput = Exclude<RouterInputs["receipt"]["list"], void>;

type ListFilters = { status: ReceiptStatus | null; match: "all" | "unmatched" };

export const DEFAULT_FILTERS: ListFilters = { status: null, match: "all" };

/** Shared by the view and the page's prefetch, so the prefetch can't miss. */
export function toListInput({ status, match }: ListFilters): ListInput {
	return { status: status ?? undefined, unmatchedOnly: match === "unmatched" };
}
