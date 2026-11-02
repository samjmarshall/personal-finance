"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { PageHeader } from "~/components/page-header";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { IMPORT_MAX_YEARS } from "~/domain/cdr";
import { formatCount } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ImportForm } from "./import-form";
import { ImportStatus } from "./import-status";
import { PossibleDuplicateList } from "./possible-duplicate-list";

const POLL_MS = 3000;

export function ImportView() {
	const [latest] = api.cdr.latestImport.useSuspenseQuery(undefined, {
		// The import runs in Inngest; poll only while it's live.
		refetchInterval: (query) => (query.state.data?.active ? POLL_MS : false),
	});
	const active = latest?.active ?? false;
	// Same cache as the list below, so the heading's count and the cards can't disagree.
	const [reviews] = api.transaction.possibleDuplicates.useSuspenseQuery();

	const utils = api.useUtils();
	const runId = latest?.id;
	const seen = useRef({ id: runId, active });
	useEffect(() => {
		// A run ended: its new rows and reviews are in. A short run can end before
		// the first poll, so a new run already finished counts too.
		const ended = seen.current.active || seen.current.id !== runId;
		if (ended && !active) {
			void utils.transaction.invalidate();
			void utils.expense.consumption.invalidate();
		}
		seen.current = { id: runId, active };
	}, [active, runId, utils]);

	const rangeId = useId();
	const latestId = useId();
	const reviewId = useId();
	const reviewHeading = useRef<HTMLHeadingElement>(null);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
			<PageHeader
				actions={
					<Link
						className={buttonVariants({ variant: "outline", size: "sm" })}
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
					className="text-base font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					id={reviewId}
					ref={reviewHeading}
					tabIndex={-1}
				>
					To review
					{reviews.length > 0 && (
						<span className="tabular font-normal text-muted-foreground">
							<span aria-hidden="true"> · </span>
							<span className="sr-only">, </span>
							{formatCount(reviews.length)}
						</span>
					)}
				</h2>
				<PossibleDuplicateList
					onEmptied={() => reviewHeading.current?.focus()}
				/>
			</section>
		</div>
	);
}
