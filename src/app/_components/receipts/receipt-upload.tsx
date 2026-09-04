"use client";

import { upload } from "@vercel/blob/client";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

const ACCEPT = "image/jpeg,image/png,application/pdf";

// Two-step client upload: the file goes straight to Blob (token minted by
// /api/receipts/upload), then receipt.create persists the row + fires the worker.
// The row is created here, not in Blob's completion webhook, which never reaches localhost.
export function ReceiptUpload() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const utils = api.useUtils();
	const create = api.receipt.create.useMutation({
		onSuccess: () => utils.receipt.invalidate(),
	});

	async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setError(null);
		setUploading(true);
		try {
			const blob = await upload(file.name, file, {
				access: "public",
				handleUploadUrl: "/api/receipts/upload",
				contentType: file.type,
			});
			await create.mutateAsync({
				blobUrl: blob.url,
				blobPathname: blob.pathname,
				contentType: blob.contentType,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
			// Clear so re-picking the same file fires onChange again.
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	return (
		<div className="flex flex-col gap-1.5">
			<input
				accept={ACCEPT}
				className="hidden"
				onChange={onFileChange}
				ref={inputRef}
				type="file"
			/>
			<Button
				disabled={uploading}
				onClick={() => inputRef.current?.click()}
				type="button"
			>
				<Upload data-icon="inline-start" />
				{uploading ? "Uploading…" : "Upload receipt"}
			</Button>
			{error ? <p className="text-destructive text-sm">{error}</p> : null}
		</div>
	);
}
