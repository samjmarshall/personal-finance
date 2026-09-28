import { api, HydrateClient } from "~/trpc/server";
import { CategoriesView } from "./_components/categories-view";

export default async function ExpenseCategoriesPage() {
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<CategoriesView />
		</HydrateClient>
	);
}
