import type { Frequency, Priority } from "~/lib/constants";
import type { RouterInputs } from "~/trpc/react";

export type ListInput = RouterInputs["transaction"]["list"];
export type SortBy = "date" | "description" | "amount" | "group" | "priority";

export const PAGE_SIZE = 50;

type ListFilters = {
	search: string;
	priority: Priority | null;
	frequency: Frequency | null;
	sortBy: SortBy;
	sortDir: "asc" | "desc";
	page: number;
};

export const DEFAULT_FILTERS: ListFilters = {
	search: "",
	priority: null,
	frequency: null,
	sortBy: "date",
	sortDir: "desc",
	page: 0,
};

/** Shared by the view and the page's prefetch, so the prefetch can't miss. */
export function toListInput(filters: ListFilters): ListInput {
	return {
		search: filters.search || undefined,
		priority: filters.priority ?? undefined,
		frequency: filters.frequency ?? undefined,
		sortBy: filters.sortBy,
		sortDir: filters.sortDir,
		limit: PAGE_SIZE,
		offset: filters.page * PAGE_SIZE,
	};
}
