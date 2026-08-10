import { redirect } from "next/navigation";

import { AppNav, MobileNav } from "~/app/_components/app-nav";
import { getSession } from "~/server/better-auth/server";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const session = await getSession();
	if (!session) redirect("/sign-in");

	const userName = session.user?.name || session.user?.email || "Member";

	return (
		<div className="flex min-h-screen bg-background">
			<AppNav userName={userName} />
			<div className="flex min-w-0 flex-1 flex-col">
				<MobileNav userName={userName} />
				<main className="flex-1">{children}</main>
			</div>
		</div>
	);
}
