import { redirect } from "next/navigation";

import { AuthForm } from "~/app/_components/auth-form";
import { AuthShell } from "~/app/_components/auth-shell";
import { getSession } from "~/server/better-auth/server";

export default async function SignInPage() {
	const session = await getSession();
	if (session) redirect("/");

	return (
		<AuthShell
			title="Welcome back"
			subtitle="Sign in to your household ledger."
		>
			<AuthForm mode="sign-in" />
		</AuthShell>
	);
}
