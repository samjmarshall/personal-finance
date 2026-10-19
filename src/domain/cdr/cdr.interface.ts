import type { CdrConnectionStatus } from "~/lib/constants";

export interface CdrSyncState {
	id: number;
	accountId: string;
	accountName: string | null;
	connectionId: string | null;
	connectionStatus: CdrConnectionStatus;
	createdAt: Date;
	highWaterMark: Date | null;
	lastError: string | null;
	lastSyncedAt: Date | null;
	updatedAt: Date | null;
}
