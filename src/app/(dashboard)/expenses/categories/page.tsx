import { AsyncBoundary } from "~/components/async-boundary";
import { CategoriesSkeleton } from "~/components/route-skeletons";
import { api, HydrateClient } from "~/trpc/server";
import { CategoriesView } from "./_components/categories-view";

export default function CategoriesPage() {
	return (
		<AsyncBoundary
			fade={false}
			label="categories"
			skeleton={<CategoriesSkeleton />}
		>
			<CategoriesData />
		</AsyncBoundary>
	);
}

async function CategoriesData() {
	void api.category.list.prefetch();
	void api.expense.countsByCategory.prefetch();
	return (
		<HydrateClient>
			<CategoriesView />
		</HydrateClient>
	);
}
