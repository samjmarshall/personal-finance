"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LoadingRegion } from "~/components/async-boundary";
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

// Every page's first loading boundary, so a nav paints this. Same skeleton the
// page's own boundary shows next, so nothing shifts.
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

	return <LoadingRegion label={label} skeleton={skeleton} />;
}
