import { CategoriesView } from "~/app/_components/expenses/categories-view";
import { api, HydrateClient } from "~/trpc/server";

export default async function ExpenseCategoriesPage() {
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<CategoriesView />
		</HydrateClient>
	);
}
