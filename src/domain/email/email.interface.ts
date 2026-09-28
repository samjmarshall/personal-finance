export interface InboundAttachmentMeta {
	id: string;
	filename?: string | null;
	content_type?: string | null;
	content_disposition?: string | null;
	content_id?: string | null;
}

export interface InboundEmailEvent {
	type: string;
	data: {
		email_id: string;
		from: string;
		attachments: InboundAttachmentMeta[];
	};
}
