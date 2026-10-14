"use client";

import { upload } from "@vercel/blob/client";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { prepReceipt } from "./prep-receipt";

// HEIC/HEIF are listed so the OS picker shows iPhone photos; prepReceipt converts
// them (and compresses everything) to a JPEG before upload.
const ACCEPT =
	"image/jpeg,image/png,application/pdf,image/heic,image/heif,.heic,.heif";

// Two-step client upload: prepReceipt normalizes the pick to a compact JPEG, the
// file goes straight to Blob (token minted by /api/receipts/upload), then
// receipt.create persists the row + fires the worker. The row is created here, not
// in Blob's completion webhook, which never reaches localhost.
export function ReceiptUpload({
	uploadPrefix,
}: {
	/** The server refuses any other pathname (adr028). */
	uploadPrefix: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [status, setStatus] = useState<"idle" | "processing" | "uploading">(
		"idle",
	);

	const utils = api.useUtils();
	const create = api.receipt.create.useMutation({
		onSuccess: () => {
			utils.receipt.invalidate();
			toast.success("Receipt uploaded");
		},
	});

	async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		// Clear so re-picking the same file fires onChange again.
		event.target.value = "";

		setStatus("processing");
		let ready: File;
		try {
			ready = await prepReceipt(file);
		} catch (err) {
			// corrupt/unreadable file — back to idle so the member can retry
			toast.error(
				err instanceof Error ? err.message : "Couldn't read that image",
			);
			setStatus("idle");
			return;
		}

		// Direct PUT to Blob. This isn't a tRPC mutation, so the global
		// MutationCache toast (ADR001) can't cover it — surface failures here, then
		// reset. Receipts are sensitive, so the store is private: the blob URL is
		// only reachable with a signed/authenticated request, never anonymously.
		setStatus("uploading");
		let blob: Awaited<ReturnType<typeof upload>>;
		try {
			blob = await upload(`${uploadPrefix}${ready.name}`, ready, {
				access: "private",
				handleUploadUrl: "/api/receipts/upload",
				contentType: ready.type,
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed");
			setStatus("idle");
			return;
		}

		try {
			await create.mutateAsync({
				blobUrl: blob.url,
				blobPathname: blob.pathname,
				contentType: blob.contentType,
			});
		} catch {
			// The failure already surfaced via the global MutationCache toast; swallow
			// here only to keep the promise from rejecting unhandled.
		} finally {
			setStatus("idle");
		}
	}

	return (
		<>
			<input
				accept={ACCEPT}
				className="hidden"
				onChange={onFileChange}
				ref={inputRef}
				type="file"
			/>
			<Button
				loading={status !== "idle"}
				onClick={() => inputRef.current?.click()}
				type="button"
			>
				<Upload data-icon="inline-start" />
				{status === "processing"
					? "Processing…"
					: status === "uploading"
						? "Uploading…"
						: "Upload receipt"}
			</Button>
		</>
	);
}
