"use client";

import {
	FileText,
	ImageOff,
	type LucideIcon,
	Mail,
	SquareArrowOutUpRight,
} from "lucide-react";
import { useState } from "react";

import { type ReceiptMediaKind, receiptMediaKind } from "~/domain/receipts";
import { cn } from "~/lib/utils";

const STAND_IN = {
	pdf: { Icon: FileText, label: "PDF receipt" },
	text: { Icon: Mail, label: "Email receipt" },
} as const;

// An <img> only draws images: a PDF won't render and an email body comes back as
// octet-stream, so null means the real image is safe to show.
export function previewIcon(contentType: string | null) {
	const kind = receiptMediaKind(contentType);
	if (kind === null) return ImageOff;
	return kind === "image" ? null : STAND_IN[kind].Icon;
}

// Where the button shows text, its name contains it (WCAG 2.5.3).
const OPEN_LABEL: Record<ReceiptMediaKind, string> = {
	image: "Open full receipt",
	pdf: "Open PDF receipt",
	text: "Open email receipt",
};

// Capped so a long receipt doesn't push the extraction off-screen; the viewer
// shows it whole.
const FRAME =
	"h-fit max-h-64 w-full overflow-hidden rounded-lg border border-border bg-muted/40 sm:max-h-80";

const PLACEHOLDER =
	"flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground text-xs";

export function ReceiptSourceThumbnail({
	contentType,
	src,
	onOpen,
}: {
	contentType: string | null;
	src: string;
	onOpen: () => void;
}) {
	const [failed, setFailed] = useState(false);
	const kind = receiptMediaKind(contentType);

	if (kind === null)
		return (
			<div className={cn(FRAME, PLACEHOLDER)}>
				<ImageOff aria-hidden className="h-8 w-8" />
				No preview
			</div>
		);

	return (
		<button
			aria-label={
				failed ? `Preview unavailable. ${OPEN_LABEL[kind]}` : OPEN_LABEL[kind]
			}
			className={cn(
				FRAME,
				"group relative block outline-none transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
			)}
			onClick={onOpen}
			type="button"
		>
			{kind !== "image" ? (
				<StandIn {...STAND_IN[kind]} />
			) : failed ? (
				<StandIn Icon={ImageOff} label="Preview unavailable" />
			) : (
				// biome-ignore lint/performance/noImgElement: private-blob proxy, not a static asset for next/image
				<img
					alt=""
					className="h-auto w-full object-contain"
					loading="lazy"
					onError={() => setFailed(true)}
					src={src}
				/>
			)}
			<span className="absolute top-1.5 right-1.5 rounded-md border border-border bg-background/85 p-1 text-muted-foreground shadow-xs backdrop-blur-sm transition-colors group-hover:text-foreground">
				<SquareArrowOutUpRight aria-hidden className="h-3.5 w-3.5" />
			</span>
		</button>
	);
}

function StandIn({ Icon, label }: { Icon: LucideIcon; label: string }) {
	return (
		// Brightens on hover like the corner chip; a photo needs no cue.
		<span
			className={cn(
				PLACEHOLDER,
				"transition-colors group-hover:text-foreground",
			)}
		>
			<Icon aria-hidden className="h-8 w-8" />
			{label}
		</span>
	);
}
