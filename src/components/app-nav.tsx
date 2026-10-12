"use client";

import {
	CircleDashed,
	LayoutDashboard,
	type LucideIcon,
	Receipt,
	ScanLine,
	Settings,
	Tags,
	TrendingUp,
	Wallet,
	WalletMinimal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type NavLeaf = { href: string; label: string; icon: LucideIcon };
type NavSection = { label: string; icon: LucideIcon; children: NavLeaf[] };
type NavItem = NavLeaf | NavSection;

const links: NavItem[] = [
	{ href: "/", label: "Overview", icon: LayoutDashboard },
	{
		label: "Expenses",
		icon: Wallet,
		children: [
			{ href: "/expenses", label: "Planned", icon: WalletMinimal },
			{ href: "/expenses/unplanned", label: "Unplanned", icon: CircleDashed },
			{ href: "/expenses/categories", label: "Categories", icon: Tags },
		],
	},
	{ href: "/income", label: "Income", icon: TrendingUp },
	{ href: "/transactions", label: "Transactions", icon: Receipt },
	{ href: "/receipts", label: "Receipts", icon: ScanLine },
];

// Not in `links` — config, not a browse destination. Still in `flatLinks` so
// active-state matching and the mobile bar see it.
const settingsLink: NavLeaf = {
	href: "/settings",
	label: "Settings",
	icon: Settings,
};

/** Every navigable leaf, sections flattened; `group` names the parent section. */
const flatLinks: (NavLeaf & { group?: string })[] = [
	...links.flatMap((item) =>
		"children" in item
			? item.children.map((child) => ({ ...child, group: item.label }))
			: [item],
	),
	settingsLink,
];

/** Returns the href of the most specific link matching the current pathname. */
function activeHref(pathname: string) {
	let best = "";
	for (const link of flatLinks) {
		const matches =
			link.href === "/"
				? pathname === "/"
				: pathname === link.href || pathname.startsWith(`${link.href}/`);
		if (matches && link.href.length > best.length) best = link.href;
	}
	return best;
}

/** Shared row layout for nav leaves and section headers. */
const navRowClass = "flex items-center gap-3 px-3 py-2 font-medium text-sm";

function DesktopNavLink({ link, active }: { link: NavLeaf; active: boolean }) {
	const Icon = link.icon;
	return (
		<Link
			aria-current={active ? "page" : undefined}
			className={cn(
				navRowClass,
				"rounded-lg transition-colors",
				active
					? "bg-sidebar-accent text-sidebar-foreground"
					: "text-sidebar-muted hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
			)}
			href={link.href}
		>
			<Icon className="h-[18px] w-[18px]" />
			{link.label}
		</Link>
	);
}

function NavLinks({ current }: { current: string }) {
	return (
		<nav aria-label="Main navigation" className="flex flex-col gap-1">
			{links.map((item) => {
				if ("children" in item) {
					const Icon = item.icon;
					return (
						// biome-ignore lint/a11y/useSemanticElements: role="group" labels the nav subsection; <fieldset> is form-only
						<div aria-label={item.label} key={item.label} role="group">
							<div
								aria-hidden="true"
								className={cn(navRowClass, "text-sidebar-muted")}
							>
								<Icon className="h-[18px] w-[18px]" />
								{item.label}
							</div>
							<div className="ml-5 flex flex-col gap-1 border-sidebar-muted/30 border-l pl-2">
								{item.children.map((child) => (
									<DesktopNavLink
										active={child.href === current}
										key={child.href}
										link={child}
									/>
								))}
							</div>
						</div>
					);
				}
				return (
					<DesktopNavLink
						active={item.href === current}
						key={item.href}
						link={item}
					/>
				);
			})}
		</nav>
	);
}

/** Member slot is server-rendered, so the nav paints before the session read. */
export function AppNav({ member }: { member: ReactNode }) {
	const current = activeHref(usePathname());
	return (
		<aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between bg-sidebar p-4 text-sidebar-foreground lg:flex">
			<div>
				<div className="mb-8 flex items-center gap-2.5 px-2 pt-2">
					<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent">
						<Wallet className="h-[18px] w-[18px] text-sidebar-foreground" />
					</span>
					<span className="font-semibold text-base tracking-tight">Ledger</span>
				</div>
				<NavLinks current={current} />
			</div>
			<div className="flex flex-col gap-1 border-sidebar-muted/20 border-t pt-3">
				{/* Its own landmark: it sits in the footer, outside the main nav, so
				    without this the desktop Settings link is in no landmark at all. */}
				<nav aria-label="Settings">
					<DesktopNavLink
						active={current === settingsLink.href}
						link={settingsLink}
					/>
				</nav>
				{member}
			</div>
		</aside>
	);
}

export function MobileNav() {
	return (
		<header className="sticky top-0 z-30 flex items-center justify-between border-border border-b bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
			<div className="flex items-center gap-2">
				<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
					<Wallet className="h-[18px] w-[18px] text-primary-foreground" />
				</span>
				<span className="font-semibold text-base tracking-tight">Ledger</span>
			</div>
			<nav
				aria-label="Main navigation"
				className="flex items-center gap-1 overflow-x-auto"
			>
				<MobileLinks />
			</nav>
		</header>
	);
}

function MobileLinks() {
	const pathname = usePathname();
	const current = activeHref(pathname);
	return (
		<>
			{flatLinks.map((link) => {
				const active = link.href === current;
				const Icon = link.icon;
				return (
					<Link
						aria-current={active ? "page" : undefined}
						aria-label={
							link.group ? `${link.group}: ${link.label}` : link.label
						}
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
