import type { MatchCandidate, MatchTransaction } from "./match";
import { matchCandidates, matchScanWindow } from "./match";
import {
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
} from "./receipt.dto";
import type {
	ExtractionCategory,
	Receipt,
	ReceiptDetail,
	ReceiptItem,
	ReceiptItemDetail,
	ReceiptListItem,
} from "./receipt.interface";
import type { ReceiptExtraction } from "./receipt-extraction.dto";
import { receiptExtractionDto } from "./receipt-extraction.dto";
import {
	isReceiptFileType,
	RECEIPT_FILE_TYPES,
	receiptImageUrl,
} from "./receipt-media";
import type { Stage, StageState } from "./receipt-pipeline";
import { isoOrNull, receiptPipeline } from "./receipt-pipeline";

export type {
	ExtractionCategory,
	MatchCandidate,
	MatchTransaction,
	Receipt,
	ReceiptDetail,
	ReceiptExtraction,
	ReceiptItem,
	ReceiptItemDetail,
	ReceiptListItem,
	Stage,
	StageState,
};
export {
	isoOrNull,
	isReceiptFileType,
	matchCandidates,
	matchScanWindow,
	RECEIPT_FILE_TYPES,
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptExtractionDto,
	receiptImageUrl,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
	receiptPipeline,
};
