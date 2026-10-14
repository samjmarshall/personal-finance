"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { authClient } from "~/server/auth/client";

export function SignOutButton() {
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	return (
		<>
			<Button
				// Overrides Button's own height, border, padding, centring and 16px icon so the
				// row lines up with the nav links.
				className="h-auto w-full justify-start gap-3 border-0 px-3 py-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground has-data-[icon=inline-start]:pl-3 dark:hover:bg-sidebar-accent/40 [&_svg:not([class*='size-'])]:size-[18px]"
				loading={loading}
				onClick={async () => {
					setError(null);
					setLoading(true);
					// Sign-out fails closed while Redis is down (adr007), so the session stays live.
					// Don't route on: /sign-in would bounce it back here and hide the failure.
					const { error } = await authClient.signOut();
					if (error) {
						setError(error.message ?? "Could not sign out. Please try again.");
						setLoading(false);
						return;
					}
					// Full page load: kept routes and cached queries still hold the member's
					// data, and Back would show it.
					window.location.assign("/sign-in");
				}}
				type="button"
				variant="ghost"
			>
				<LogOut data-icon="inline-start" />
				Sign out
			</Button>
			{error && (
				<p
					className="rounded-md border border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] px-3 py-2 text-[var(--badge-spend-fg)] text-sm"
					role="alert"
				>
					{error}
				</p>
			)}
		</>
	);
}
