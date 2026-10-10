import { AppNav, MobileNav } from "~/components/app-nav";
import { AsyncBoundary } from "~/components/async-boundary";
import { NavMember, NavMemberSkeleton } from "~/components/nav-member";

export default function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen bg-background">
			<AppNav
				member={
					<AsyncBoundary label="member" skeleton={<NavMemberSkeleton />}>
						<NavMember />
					</AsyncBoundary>
				}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<MobileNav />
				<main className="flex-1">{children}</main>
			</div>
		</div>
	);
}
