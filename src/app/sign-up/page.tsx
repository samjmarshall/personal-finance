import { AsyncBoundary } from "~/components/async-boundary";
import { AuthForm } from "~/components/auth-form";
import { AuthShell } from "~/components/auth-shell";
import { RedirectIfSignedIn } from "~/components/redirect-if-signed-in";

export default function SignUpPage() {
	return (
		<AuthShell
			subtitle="One shared budget for the whole household."
			title="Create your ledger"
		>
			<AuthForm mode="sign-up" />
			<AsyncBoundary label="session" skeleton={null}>
				<RedirectIfSignedIn />
			</AsyncBoundary>
		</AuthShell>
	);
}
