"use client";

import {
	CircleDashed,
	LayoutDashboard,
	LogOut,
	type LucideIcon,
	Moon,
	Receipt,
	Sun,
	SunMoon,
	Tags,
	TrendingUp,
	Wallet,
	WalletMinimal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { useMounted } from "~/hooks/use-mounted";
import { cn } from "~/lib/utils";
import { authClient } from "~/server/auth/client";

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
];

/** Every navigable leaf, sections flattened; `group` names the parent section. */
const flatLinks: (NavLeaf & { group?: string })[] = links.flatMap((item) =>
	"children" in item
		? item.children.map((child) => ({ ...child, group: item.label }))
		: [item],
);

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

function DesktopNavLink({
	link,
	active,
	onNavigate,
}: {
	link: NavLeaf;
	active: boolean;
	onNavigate?: () => void;
}) {
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
			onClick={onNavigate}
		>
			<Icon className="h-[18px] w-[18px]" />
			{link.label}
		</Link>
	);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	const current = activeHref(pathname);
	return (
		<nav className="flex flex-col gap-1">
			{links.map((item) => {
				if ("children" in item) {
					const Icon = item.icon;
					return (
						// biome-ignore lint/a11y/useSemanticElements: role="group" labels the nav subsection; <fieldset> is form-only
						<div aria-label={item.label} key={item.label} role="group">
							<div
								aria-hidden="true"
								className="flex items-center gap-3 px-3 py-2 font-medium text-sidebar-muted text-sm"
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
										onNavigate={onNavigate}
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
						onNavigate={onNavigate}
					/>
				);
			})}
		</nav>
	);
}

function SignOutButton() {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	return (
		<>
			<button
				className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-medium text-sidebar-muted text-sm transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground disabled:opacity-50"
				disabled={loading}
				onClick={async () => {
					setError(null);
					setLoading(true);
					// Sign-out fails closed while Redis is down (adr007), which leaves the
					// session live. Routing on regardless would land on /sign-in, which
					// redirects a live session straight back here — the silent
					// still-signed-out lie the fail-closed delete exists to prevent.
					const { error } = await authClient.signOut();
					if (error) {
						setError(error.message ?? "Could not sign out. Please try again.");
						setLoading(false);
						return;
					}
					router.push("/sign-in");
					router.refresh();
				}}
				type="button"
			>
				<LogOut className="h-[18px] w-[18px]" />
				{loading ? "Signing out…" : "Sign out"}
			</button>
			{error && (
				<p
					className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend"
					role="alert"
				>
					{error}
				</p>
			)}
		</>
	);
}

function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	// resolvedTheme is unknown until next-themes resolves it post-mount; show a
	// neutral affordance until then so a dark-resolved user never sees the
	// inverted "switch to dark" label/icon for a frame.
	const mounted = useMounted();
	const isDark = resolvedTheme === "dark";

	let Icon = SunMoon;
	let label = "Toggle theme";
	let ariaLabel = "Toggle theme";
	if (mounted) {
		Icon = isDark ? Sun : Moon;
		label = isDark ? "Light mode" : "Dark mode";
		ariaLabel = isDark ? "Switch to light mode" : "Switch to dark mode";
	}
	return (
		<button
			aria-label={ariaLabel}
			className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-medium text-sidebar-muted text-sm transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			type="button"
		>
			<Icon className="h-[18px] w-[18px]" />
			{label}
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
				<ThemeToggle />
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
			<nav
				aria-label="Main navigation"
				className="flex items-center gap-1 overflow-x-auto"
			>
				<MobileLinks />
			</nav>
			<span className="sr-only">{userName}</span>
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
