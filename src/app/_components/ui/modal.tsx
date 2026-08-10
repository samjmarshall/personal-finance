"use client";

import { X } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";

export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	className,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: React.ReactNode;
	className?: string;
}) {
	React.useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = "";
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
			<button
				aria-label="Close dialog"
				className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]"
				onClick={onClose}
				type="button"
			/>
			<div
				aria-label={title}
				aria-modal="true"
				className={cn(
					"relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:max-w-lg sm:rounded-2xl",
					className,
				)}
				role="dialog"
			>
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<h2 className="text-balance font-semibold text-foreground text-lg">
							{title}
						</h2>
						{description && (
							<p className="mt-1 text-pretty text-muted-foreground text-sm">
								{description}
							</p>
						)}
					</div>
					<button
						aria-label="Close"
						className="-mt-1 -mr-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onClick={onClose}
						type="button"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}
