"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "~/hooks/use-mounted";
import { cn } from "~/lib/utils";
import { SettingsSection } from "./settings-section";

// System leads: it's the provider's defaultTheme, so it's what an untouched browser
// is already on.
const themes = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

/** Miniature of the app's rail and content, painted in a forced theme so a tile can
 *  show a palette the app isn't currently in. */
function ThemePreview({ tone }: { tone: "light" | "dark" }) {
	return (
		// The tone class re-declares that theme's custom properties on this subtree,
		// so the tile paints from the same tokens as the real app — a hand-copied
		// palette goes stale the moment globals.css is retuned.
		<span
			aria-hidden="true"
			className={cn(
				"flex h-16 w-full overflow-hidden rounded-lg bg-background ring-1 ring-foreground/15",
				tone,
			)}
		>
			{/* The rail is the same slate in both themes — that's the point of the tile. */}
			<span className="h-full w-1/4 bg-sidebar" />
			<span className="flex flex-1 flex-col gap-1.5 p-2">
				<span className="h-1.5 w-3/4 rounded-full bg-border" />
				<span className="flex-1 rounded bg-card" />
			</span>
		</span>
	);
}

export function AppearanceSection() {
	const { resolvedTheme, setTheme, systemTheme, theme } = useTheme();
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
		<SettingsSection
			description={`${summary} — saved to this browser, not shared with your household.`}
			title="Appearance"
		>
			<div className="mt-5 grid gap-3 sm:grid-cols-3">
				{themes.map(({ value, label, icon: Icon }) => {
					const active = mounted && theme === value;
					// systemTheme, not resolvedTheme: resolvedTheme is only the OS
					// preference while the active theme IS system — otherwise it just
					// echoes `theme`, so a member on forced Dark would see a dark System
					// tile that switches them to light. Gated on `mounted` because the
					// server has neither value, and React swallows hydration attribute
					// mismatches rather than patching them — an ungated tile would stay
					// wrong for the whole session.
					const tone =
						value === "system"
							? mounted && systemTheme === "dark"
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
		</SettingsSection>
	);
}
