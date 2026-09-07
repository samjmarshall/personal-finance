"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "~/hooks/use-mounted";
import { cn } from "~/lib/utils";

// System leads: it's the provider's defaultTheme, so it's what an untouched browser
// is already on.
const themes = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

/** Miniature of the app's rail and content in a fixed palette, so a tile can show a
 *  theme the app isn't currently in. */
function ThemePreview({ tone }: { tone: "light" | "dark" }) {
	const palette =
		tone === "dark"
			? { page: "#14181d", card: "#1c2127", bar: "#333b45" }
			: { page: "#f4f6f8", card: "#ffffff", bar: "#dfe4ea" };
	return (
		<span
			aria-hidden="true"
			className="flex h-16 w-full overflow-hidden rounded-lg ring-1 ring-foreground/15"
			style={{ background: palette.page }}
		>
			{/* The rail is the same slate in both themes — that's the point of the tile. */}
			<span className="h-full w-1/4" style={{ background: "#2b3440" }} />
			<span className="flex flex-1 flex-col gap-1.5 p-2">
				<span
					className="h-1.5 w-3/4 rounded-full"
					style={{ background: palette.bar }}
				/>
				<span className="flex-1 rounded" style={{ background: palette.card }} />
			</span>
		</span>
	);
}

export function AppearanceSection() {
	const { resolvedTheme, setTheme, theme } = useTheme();
	// next-themes resolves the stored choice only after mount. Until then no tile is
	// marked, so a device-dark member never sees Light flagged as theirs for a frame.
	const mounted = useMounted();

	let summary = "Choose how Ledger looks";
	if (mounted) {
		summary =
			theme === "system"
				? `Following your device — currently ${resolvedTheme}`
				: `Always ${theme}`;
	}

	return (
		<section>
			<h2 className="font-semibold text-base text-foreground tracking-tight">
				Appearance
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">
				{summary} — saved to this browser, not shared with your household.
			</p>

			<div className="mt-5 grid gap-3 sm:grid-cols-3">
				{themes.map(({ value, label, icon: Icon }) => {
					const active = mounted && theme === value;
					// Gated on `mounted` like `active`, and for a sharper reason: the
					// server has no resolvedTheme, so an ungated tile renders a different
					// palette here than in the server HTML. React swallows attribute
					// mismatches at hydration rather than patching them, and resolvedTheme
					// never changes again — so a device-dark member would be stuck looking
					// at a light System preview for the whole session.
					const tone =
						value === "system"
							? mounted && resolvedTheme === "dark"
								? "dark"
								: "light"
							: value;
					return (
						<button
							aria-pressed={active}
							className={cn(
								"rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
								active
									? "border-primary bg-accent/40"
									: "border-border hover:border-foreground/30",
							)}
							key={value}
							onClick={() => setTheme(value)}
							type="button"
						>
							<ThemePreview tone={tone} />
							<span className="mt-3 flex items-center gap-2 font-medium text-foreground text-sm">
								<Icon className="h-4 w-4" />
								{label}
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}
