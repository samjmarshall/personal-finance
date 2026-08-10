"use client";

import {
	LayoutDashboard,
	LogOut,
	Receipt,
	TrendingUp,
	Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { authClient } from "~/server/better-auth/client";

const links = [
	{ href: "/", label: "Overview", icon: LayoutDashboard },
	{ href: "/expenses", label: "Planned Expenses", icon: Wallet },
	{ href: "/income", label: "Income", icon: TrendingUp },
	{ href: "/transactions", label: "Transactions", icon: Receipt },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	return (
		<nav className="flex flex-col gap-1">
			{links.map((link) => {
				const active =
					link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
				const Icon = link.icon;
				return (
					<Link
						className={cn(
							"flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
							active
								? "bg-sidebar-accent text-sidebar-foreground"
								: "text-sidebar-muted hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
						)}
						href={link.href}
						key={link.href}
						onClick={onNavigate}
					>
						<Icon className="h-[18px] w-[18px]" />
						{link.label}
					</Link>
				);
			})}
		</nav>
	);
}

function SignOutButton() {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	return (
		<button
			className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-medium text-sidebar-muted text-sm transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground disabled:opacity-50"
			disabled={loading}
			onClick={async () => {
				setLoading(true);
				await authClient.signOut();
				router.push("/sign-in");
				router.refresh();
			}}
			type="button"
		>
			<LogOut className="h-[18px] w-[18px]" />
			{loading ? "Signing out…" : "Sign out"}
		</button>
	);
}

export function AppNav({ userName }: { userName: string }) {
	return (
		<aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between bg-sidebar p-4 text-sidebar-foreground lg:flex">
			<div>
				<div className="mb-8 flex items-center gap-2.5 px-2 pt-2">
					<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent">
						<Wallet className="h-[18px] w-[18px] text-sidebar-foreground" />
					</span>
					<span className="font-semibold text-base tracking-tight">Ledger</span>
				</div>
				<NavLinks />
			</div>
			<div className="flex flex-col gap-1 border-sidebar-muted/20 border-t pt-3">
				<div className="px-3 py-1.5">
					<p className="text-sidebar-muted text-xs">Signed in as</p>
					<p className="truncate font-medium text-sidebar-foreground text-sm">
						{userName}
					</p>
				</div>
				<SignOutButton />
			</div>
		</aside>
	);
}

export function MobileNav({ userName }: { userName: string }) {
	return (
		<header className="sticky top-0 z-30 flex items-center justify-between border-border border-b bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
			<div className="flex items-center gap-2">
				<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
					<Wallet className="h-[18px] w-[18px] text-primary-foreground" />
				</span>
				<span className="font-semibold text-base tracking-tight">Ledger</span>
			</div>
			<div className="flex items-center gap-1 overflow-x-auto">
				<MobileLinks />
			</div>
			<span className="sr-only">{userName}</span>
		</header>
	);
}

function MobileLinks() {
	const pathname = usePathname();
	return (
		<>
			{links.map((link) => {
				const active =
					link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
				const Icon = link.icon;
				return (
					<Link
						aria-label={link.label}
						className={cn(
							"flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
							active
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-muted",
						)}
						href={link.href}
						key={link.href}
					>
						<Icon className="h-[18px] w-[18px]" />
					</Link>
				);
			})}
		</>
	);
}
