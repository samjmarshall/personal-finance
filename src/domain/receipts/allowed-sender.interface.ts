// An address the inbound webhook will ingest mail from, and the Member it attributes
// that mail to. Anything not on this list is dropped.
export interface AllowedSender {
	id: number;
	// Stored lower-cased and trimmed so it matches the webhook's parsed sender.
	email: string;
	userId: string;
	createdAt: Date;
}

// An allowed sender as the Settings panel lists it: the row plus the owning Member's
// name (null when the auth row carries none).
export interface AllowedSenderListItem extends AllowedSender {
	userName: string | null;
	// Whether the row belongs to the caller. The whole household's allowlist is
	// listed but only your own entries are removable, so the panel needs to know
	// which rows to offer a remove button for.
	isOwn: boolean;
}
