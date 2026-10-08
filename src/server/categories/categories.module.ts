import { db } from "~/server/db";

import { DrizzleCategoriesRepository } from "./categories.repository";
import { CategoriesService } from "./categories.service";

// Shared by the tRPC root, transactions.module.ts and the receipts worker in
// src/server/inngest/functions.ts.
export const categoriesService = new CategoriesService({
	repository: new DrizzleCategoriesRepository({ db }),
});
