import type { CdrConnectionStatus } from "~/lib/constants";

export interface CdrSyncState {
	id: number;
	accountId: string;
	accountName: string | null;
	accountNumber: string | null;
	balance: number | null;
	balanceAsOf: Date | null;
	connectionId: string | null;
	connectionStatus: CdrConnectionStatus;
	createdAt: Date;
	highWaterMark: Date | null;
	inBalance: boolean | null;
	institutionName: string | null;
	lastError: string | null;
	lastSyncedAt: Date | null;
	nickname: string | null;
	updatedAt: Date | null;
}
