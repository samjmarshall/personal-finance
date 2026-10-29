"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { PageHeader } from "~/components/page-header";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { IMPORT_MAX_YEARS } from "~/domain/cdr";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ImportForm } from "./import-form";
import { ImportStatus } from "./import-status";
import { CHOICES } from "./possible-duplicate-card";
import { PossibleDuplicateList } from "./possible-duplicate-list";

const POLL_MS = 3000;

export function ImportView() {
	const [latest] = api.cdr.latestImport.useSuspenseQuery(undefined, {
		// The import runs in Inngest; poll only while it's live.
		refetchInterval: (query) => (query.state.data?.active ? POLL_MS : false),
	});
	const active = latest?.active ?? false;

	const utils = api.useUtils();
	const wasActive = useRef(active);
	useEffect(() => {
		// The run just ended: its new rows and reviews are in.
		if (wasActive.current && !active) {
			void utils.transaction.invalidate();
			void utils.expense.consumption.invalidate();
		}
		wasActive.current = active;
	}, [active, utils]);

	const rangeId = useId();
	const latestId = useId();
	const reviewId = useId();
	const reviewHeading = useRef<HTMLHeadingElement>(null);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Link
						// Merge classes: a plain join lets the base transparent border win.
						className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
						href="/transactions"
					>
						<ArrowLeft aria-hidden />
						Transactions
					</Link>
				}
				description={`Bring in older history from your bank, up to ${IMPORT_MAX_YEARS} years back.`}
				title="Import from bank"
			/>

			<div className="mt-6 grid gap-4 lg:grid-cols-5">
				<Card aria-labelledby={rangeId} className="lg:col-span-3" role="region">
					<CardContent>
						<h2 className="text-sm font-semibold text-foreground" id={rangeId}>
							Pick a range
						</h2>
						<div className="mt-3">
							<ImportForm locked={active} />
						</div>
					</CardContent>
				</Card>
				<Card
					aria-labelledby={latestId}
					className="lg:col-span-2"
					role="region"
				>
					<CardContent>
						<h2 className="text-sm font-semibold text-foreground" id={latestId}>
							Latest import
						</h2>
						<div className="mt-3">
							<ImportStatus latest={latest} />
						</div>
					</CardContent>
				</Card>
			</div>

			<section aria-labelledby={reviewId} className="mt-8">
				<h2
					className="text-base font-semibold text-foreground"
					id={reviewId}
					ref={reviewHeading}
					tabIndex={-1}
				>
					To review
				</h2>
				<p className="mt-1 text-sm text-pretty text-muted-foreground">
					These bank rows look like ones you already have, but not exactly.
				</p>
				<ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
					{CHOICES.map(({ choice, label, effect }) => (
						<li key={choice}>
							<span className="font-medium text-foreground">{label}</span>{" "}
							{effect}
						</li>
					))}
				</ul>
				<div className="mt-4">
					<PossibleDuplicateList
						onEmptied={() => reviewHeading.current?.focus()}
					/>
				</div>
			</section>
		</div>
	);
}
