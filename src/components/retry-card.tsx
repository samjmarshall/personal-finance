"use client";

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type Ref, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

type RetryCardProps = {
	/** Read as "Couldn't load {label}." */
	label: string;
	/** Next's error-boundary `retry`. */
	retry: () => void;
	onRetry?: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
	className?: string;
};

/** Shared, so section and page failures look the same. */
export function RetryCard({
	label,
	retry,
	onRetry,
	buttonRef,
	className,
}: RetryCardProps) {
	const { reset: resetQueryErrors } = useQueryErrorResetBoundary();
	const [retrying, setRetrying] = useState(false);

	return (
		<Card className={cn("text-center", className)} role="alert">
			<CardContent className="flex flex-col items-center gap-3">
				<p className="text-muted-foreground text-sm">Couldn't load {label}.</p>
				<Button
					// The card stays up while the retry runs; show it's working.
					loading={retrying}
					onClick={() => {
						setRetrying(true);
						// Clear cached query errors first, or a failed query rethrows its
						// old error. Next's plain reset skips re-fetching server content.
						resetQueryErrors();
						onRetry?.();
						retry();
					}}
					ref={buttonRef}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</CardContent>
		</Card>
	);
}
