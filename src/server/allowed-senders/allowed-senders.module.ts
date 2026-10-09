import { membersService } from "~/server/auth/members.module";
import { db } from "~/server/db";

import { DrizzleAllowedSendersRepository } from "./allowed-senders.repository";
import { AllowedSendersService } from "./allowed-senders.service";

// One shared instance. Other roots import it; don't rebuild it.
export const allowedSendersService = new AllowedSendersService({
	repository: new DrizzleAllowedSendersRepository({ db }),
	members: membersService,
});
