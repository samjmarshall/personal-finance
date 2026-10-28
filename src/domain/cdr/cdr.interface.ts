import type { CdrConnectionStatus, CdrImportStatus } from "~/lib/constants";

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

export interface CdrImport {
	id: number;
	added: number;
	adopted: number;
	createdAt: Date;
	error: string | null;
	finishedAt: Date | null;
	flagged: number;
	fromDate: Date;
	known: number;
	status: CdrImportStatus;
	toDate: Date;
}

// `active`: queued or running and young enough that its job may still report.
export type LatestImport = CdrImport & { active: boolean };
