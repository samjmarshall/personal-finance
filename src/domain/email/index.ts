import {
	allowedSenderCreateDto,
	allowedSenderRefDto,
} from "./allowed-sender.dto";
import type {
	AllowedSender,
	AllowedSenderListItem,
} from "./allowed-sender.interface";
import { inboundEmailEventDto } from "./email.dto";
import type {
	InboundAttachmentMeta,
	InboundEmailEvent,
} from "./email.interface";

export type {
	AllowedSender,
	AllowedSenderListItem,
	InboundAttachmentMeta,
	InboundEmailEvent,
};
export { allowedSenderCreateDto, allowedSenderRefDto, inboundEmailEventDto };
