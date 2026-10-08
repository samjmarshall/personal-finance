import { db } from "~/server/db";

import { DrizzleMembersRepository } from "./members.repository";
import { MembersService } from "./members.service";

// Not exposed to controllers; only other services use it.
export const membersService = new MembersService({
	repository: new DrizzleMembersRepository({ db }),
});
