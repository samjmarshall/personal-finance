"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageSkeleton } from "~/components/page-skeleton";
import {
	CategoriesSkeleton,
	ExpensesSkeleton,
	IncomeSkeleton,
	OverviewSkeleton,
	ReceiptsSkeleton,
	SettingsSkeleton,
	TransactionsSkeleton,
	UnplannedSkeleton,
} from "~/components/route-skeletons";

// Prefetch stops at the first loading boundary, which for every section is this
// file, so a nav paints it, not a nested loading.tsx. It draws the target page's
// skeleton, the same one that page's own boundary shows next.
const pages: Record<string, { label: string; skeleton: ReactNode }> = {
	"/": { label: "overview", skeleton: <OverviewSkeleton /> },
	"/expenses": { label: "expenses", skeleton: <ExpensesSkeleton /> },
	"/expenses/unplanned": {
		label: "unplanned Spend",
		skeleton: <UnplannedSkeleton />,
	},
	"/expenses/categories": {
		label: "categories",
		skeleton: <CategoriesSkeleton />,
	},
	"/income": { label: "income", skeleton: <IncomeSkeleton /> },
	"/transactions": {
		label: "transactions",
		skeleton: <TransactionsSkeleton />,
	},
	"/receipts": { label: "receipts", skeleton: <ReceiptsSkeleton /> },
	"/settings": { label: "settings", skeleton: <SettingsSkeleton /> },
};

export default function DashboardLoading() {
	const { label, skeleton } = pages[usePathname()] ?? {
		label: "page",
		skeleton: <PageSkeleton />,
	};

	// Status sits outside the busy region, as in AsyncBoundary.
	return (
		<>
			<div aria-busy="true">{skeleton}</div>
			<span className="sr-only" role="status">
				Loading {label}
			</span>
		</>
	);
}
