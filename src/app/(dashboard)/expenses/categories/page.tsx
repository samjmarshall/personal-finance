import { api, HydrateClient } from "~/trpc/server";
import { CategoriesView } from "./_components/categories-view";

export default async function CategoriesPage() {
	void api.category.list.prefetch();
	void api.expense.countsByCategory.prefetch();
	return (
		<HydrateClient>
			<CategoriesView />
		</HydrateClient>
	);
}
