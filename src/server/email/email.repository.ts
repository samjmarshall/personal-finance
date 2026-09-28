import { eq } from "drizzle-orm";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { buildOutboxEvent } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { receipts } from "~/server/receipts/receipts.schema";
import { allowedSenders } from "./allowed-sender.schema";

/** Blob columns for a row about to be minted; the store has already accepted the write. */
export interface StoredBlob {
	blobUrl: string;
	blobPathname: string;
	contentType: string;
}

/** Data tier for inbound-email ingestion: the allowlist read and the pending-row mint. */
export interface EmailRepository {
	/** `email` must already be bare + lower-cased — the shape the allowlist stores. */
	findAllowedSender(email: string): Promise<{ userId: string } | undefined>;
	/**
	 * One pending email-channel row per blob plus one `receipt/email.received` per
	 * row, committed together through the outbox. Returns ids in input order.
	 * `traceId` is the ingest trace stamped on every minted row (null when unset).
	 */
	createPendingReceipts(
		userId: string,
		blobs: StoredBlob[],
		traceId: string | null,
	): Promise<number[]>;
}

interface DrizzleEmailRepositoryDeps {
	db: typeof realDb;
	outbox: OutboxWriteDoor;
}

export class DrizzleEmailRepository implements EmailRepository {
	private readonly db: typeof realDb;
	private readonly outbox: OutboxWriteDoor;

	constructor({ db, outbox }: DrizzleEmailRepositoryDeps) {
		this.db = db;
		this.outbox = outbox;
	}

	async findAllowedSender(
		email: string,
	): Promise<{ userId: string } | undefined> {
		const [sender] = await this.db
			.select({ userId: allowedSenders.userId })
			.from(allowedSenders)
			.where(eq(allowedSenders.email, email))
			.limit(1);
		return sender;
	}

	// The frozen payload carries only a receiptId, so the row must exist before the
	// event fires — which is what makes the event a function of the write's result.
	// Blobs were written before this transaction, so a rolled-back commit leaves an
	// orphan blob: the same trade the receipt delete path already makes.
	async createPendingReceipts(
		userId: string,
		blobs: StoredBlob[],
		traceId: string | null,
	): Promise<number[]> {
		const rows = await this.outbox.commit(
			async (tx) =>
				tx
					.insert(receipts)
					.values(
						blobs.map((blob) => ({
							userId,
							status: ReceiptStatus.Pending,
							channel: ReceiptChannel.Email,
							blobUrl: blob.blobUrl,
							blobPathname: blob.blobPathname,
							contentType: blob.contentType,
							traceId,
						})),
					)
					.returning({ id: receipts.id }),
			(inserted) =>
				inserted.map((row) =>
					buildOutboxEvent("receipt/email.received", { receiptId: row.id }),
				),
		);
		return rows.map((row) => row.id);
	}
}
