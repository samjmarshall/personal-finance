import { redirect } from "next/navigation";

import { AuthForm } from "~/app/_components/auth-form";
import { AuthShell } from "~/app/_components/auth-shell";
import { getSession } from "~/server/better-auth/server";

export default async function SignUpPage() {
	const session = await getSession();
	if (session) redirect("/");

	return (
		<AuthShell
			title="Create your ledger"
			subtitle="One shared budget for the whole household."
		>
			<AuthForm mode="sign-up" />
		</AuthShell>
	);
}
