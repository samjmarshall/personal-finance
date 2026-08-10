import { Wallet } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
}) {
	return (
		<main className="grid min-h-screen lg:grid-cols-2">
			{/* Brand panel */}
			<div className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
				<div className="flex items-center gap-2.5">
					<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-accent">
						<Wallet className="h-5 w-5 text-sidebar-foreground" />
					</span>
					<span className="text-lg font-semibold tracking-tight">Ledger</span>
				</div>

				<div className="max-w-md">
					<p className="text-2xl font-medium leading-relaxed text-balance">
						Every dollar accounted for.
					</p>
					<p className="mt-3 text-sm leading-relaxed text-sidebar-muted text-pretty">
						A calm, private home for your household budget — expenses, income
						and a full transaction history in one place.
					</p>
				</div>

				<p className="text-xs text-sidebar-muted">
					Household finance · shared securely
				</p>
			</div>

			{/* Form panel */}
			<div className="flex items-center justify-center px-6 py-12">
				<div className="w-full max-w-sm">
					<div className="mb-8 flex items-center gap-2.5 lg:hidden">
						<span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
							<Wallet className="h-5 w-5 text-primary-foreground" />
						</span>
						<span className="text-lg font-semibold tracking-tight">Ledger</span>
					</div>
					<h1 className="text-2xl font-semibold tracking-tight text-balance">
						{title}
					</h1>
					<p className="mt-1.5 mb-8 text-sm text-muted-foreground text-pretty">
						{subtitle}
					</p>
					{children}
				</div>
			</div>
		</main>
	);
}
