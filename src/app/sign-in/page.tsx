import { redirect } from "next/navigation";

import { AuthForm } from "~/components/auth-form";
import { AuthShell } from "~/components/auth-shell";
import { getSession } from "~/server/auth/server";

export default async function SignInPage() {
	const session = await getSession();
	if (session) redirect("/");

	return (
		<AuthShell
			subtitle="Sign in to your household ledger."
			title="Welcome back"
		>
			<AuthForm mode="sign-in" />
		</AuthShell>
	);
}
