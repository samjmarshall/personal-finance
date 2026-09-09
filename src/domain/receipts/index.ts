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
import { receiptImageUrl } from "./receipt-media";

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
};
export {
	matchCandidates,
	matchScanWindow,
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptExtractionDto,
	receiptImageUrl,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
};
