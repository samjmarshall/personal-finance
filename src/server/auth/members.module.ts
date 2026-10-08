import { db } from "~/server/db";

import { DrizzleMembersRepository } from "./members.repository";
import { MembersService } from "./members.service";

// Off `services`: no controller calls it, only other services.
export const membersService = new MembersService({
	repository: new DrizzleMembersRepository({ db }),
});
