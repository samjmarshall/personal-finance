import { redirect } from "next/navigation";

import { SignOutButton } from "~/components/sign-out-button";
import { Skeleton } from "~/components/ui/skeleton";
import { getSession } from "~/server/auth/server";

// Sidebar is dark in both themes. Default muted fill would glare.
const sidebarSkeleton = "bg-sidebar-muted/20";

/** Proxy only checks the cookie is there; this is the session check behind it (adr026). */
export async function NavMember() {
	const session = await getSession();
	if (!session) redirect("/sign-in");

	const userName = session.user?.name || session.user?.email || "Member";

	return (
		<div className="flex flex-col gap-1">
			<div className="px-3 py-1.5">
				<p className="text-sidebar-muted text-xs">Signed in as</p>
				<p className="truncate font-medium text-sidebar-foreground text-sm">
					{userName}
				</p>
			</div>
			<SignOutButton />
		</div>
	);
}

/** Same line heights and padding as the real member block, so the name lands without a shift. */
export function NavMemberSkeleton() {
	return (
		<div aria-hidden className="flex flex-col gap-1">
			<div className="px-3 py-1.5">
				<div className="flex h-4 items-center">
					<Skeleton className={`h-3 w-16 ${sidebarSkeleton}`} />
				</div>
				<div className="flex h-5 items-center">
					<Skeleton className={`h-3.5 w-32 ${sidebarSkeleton}`} />
				</div>
			</div>
			<div className="flex items-center gap-3 px-3 py-2">
				<Skeleton className={`size-[18px] ${sidebarSkeleton}`} />
				<div className="flex h-5 items-center">
					<Skeleton className={`h-3.5 w-16 ${sidebarSkeleton}`} />
				</div>
			</div>
		</div>
	);
}
