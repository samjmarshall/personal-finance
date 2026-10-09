import type { Category } from "~/domain/categories";

// Groups follow the saved Category order, "No category" last. A Category this
// tab doesn't know yet goes under "No category" instead of vanishing.
export function groupByCategory<T extends { categoryId: number | null }>(
	items: T[],
	categories: Pick<Category, "id" | "name">[],
) {
	const known = new Set(categories.map((c) => c.id));
	const byId = new Map<number | null, T[]>();
	for (const item of items) {
		const id =
			item.categoryId !== null && known.has(item.categoryId)
				? item.categoryId
				: null;
		const arr = byId.get(id) ?? [];
		arr.push(item);
		byId.set(id, arr);
	}
	const filed = categories.flatMap((c) => {
		const grouped = byId.get(c.id);
		return grouped
			? [{ key: String(c.id), label: c.name, items: grouped }]
			: [];
	});
	const unfiled = byId.get(null);
	return unfiled
		? [...filed, { key: "none", label: "No category", items: unfiled }]
		: filed;
}
