import type { CdrSyncState } from "./cdr.interface";

type Named = Pick<CdrSyncState, "accountId" | "accountName" | "nickname">;

/** The member's nickname, else the bank's name, else the RedBark id. */
export function accountLabel({
	accountId,
	accountName,
	nickname,
}: Named): string {
	return nickname ?? accountName ?? accountId;
}
