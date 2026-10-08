import { db } from "~/server/db";

import { DrizzleCategoriesRepository } from "./categories.repository";
import { CategoriesService } from "./categories.service";

// One shared instance. Other roots import it; don't rebuild it.
export const categoriesService = new CategoriesService({
	repository: new DrizzleCategoriesRepository({ db }),
});
