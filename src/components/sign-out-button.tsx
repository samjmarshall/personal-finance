"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "~/server/auth/client";

export function SignOutButton() {
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
					// Sign-out fails closed while Redis is down (adr007), so the session stays live.
					// Don't route on: /sign-in would bounce it back here and hide the failure.
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
					className="rounded-md border border-[color:var(--badge-spend-border)] bg-[var(--badge-spend-bg)] px-3 py-2 text-[var(--badge-spend-fg)] text-sm"
					role="alert"
				>
					{error}
				</p>
			)}
		</>
	);
}
