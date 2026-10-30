import type { ReconcileCounts } from "~/domain/transactions";
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

// The counts are every chunk's reconcile, summed.
export interface CdrImport extends ReconcileCounts {
	id: number;
	createdAt: Date;
	error: string | null;
	finishedAt: Date | null;
	fromDate: Date;
	status: CdrImportStatus;
	toDate: Date;
}

// `active`: queued or running and young enough that its job may still report.
export type LatestImport = CdrImport & { active: boolean };
