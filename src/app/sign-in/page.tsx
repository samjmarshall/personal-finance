import { AsyncBoundary } from "~/components/async-boundary";
import { AuthForm } from "~/components/auth-form";
import { AuthShell } from "~/components/auth-shell";
import { RedirectIfSignedIn } from "~/components/redirect-if-signed-in";

export default function SignInPage() {
	return (
		<AuthShell
			subtitle="Sign in to your household ledger."
			title="Welcome back"
		>
			<AuthForm mode="sign-in" />
			<AsyncBoundary label="session" skeleton={null}>
				<RedirectIfSignedIn />
			</AsyncBoundary>
		</AuthShell>
	);
}
