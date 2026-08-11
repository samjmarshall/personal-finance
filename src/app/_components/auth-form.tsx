"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/server/auth/client";
import { Field } from "./ui/primitives";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const isSignUp = mode === "sign-up";

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			if (isSignUp) {
				const { error } = await authClient.signUp.email({
					email,
					password,
					name: name || email.split("@")[0] || "Member",
				});
				if (error) throw new Error(error.message ?? "Could not sign up");
			} else {
				const { error } = await authClient.signIn.email({ email, password });
				if (error) throw new Error(error.message ?? "Could not sign in");
			}
			router.push("/");
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
			setLoading(false);
		}
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={onSubmit}>
			{isSignUp && (
				<Field htmlFor="name" label="Name">
					<Input
						autoComplete="name"
						id="name"
						onChange={(e) => setName(e.target.value)}
						placeholder="Sam"
						value={name}
					/>
				</Field>
			)}
			<Field htmlFor="email" label="Email">
				<Input
					autoComplete="email"
					id="email"
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					required
					type="email"
					value={email}
				/>
			</Field>
			<Field htmlFor="password" label="Password">
				<Input
					autoComplete={isSignUp ? "new-password" : "current-password"}
					id="password"
					minLength={8}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="At least 8 characters"
					required
					type="password"
					value={password}
				/>
			</Field>

			{error && (
				<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend">
					{error}
				</p>
			)}

			<Button className="mt-1" disabled={loading} type="submit">
				{loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
			</Button>

			<p className="text-center text-muted-foreground text-sm">
				{isSignUp ? "Already have an account? " : "Need an account? "}
				<Link
					className="font-medium text-primary hover:underline"
					href={isSignUp ? "/sign-in" : "/sign-up"}
				>
					{isSignUp ? "Sign in" : "Create one"}
				</Link>
			</p>
		</form>
	);
}
