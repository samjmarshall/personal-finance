import { db } from "~/server/db";

import { DrizzleBalancesRepository } from "./balances.repository";
import { BalancesService } from "./balances.service";

// One shared instance: the tRPC root and the cdr sync worker both use it.
export const balancesService = new BalancesService({
	repository: new DrizzleBalancesRepository({ db }),
});
