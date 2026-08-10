"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "~/server/better-auth/client";
import { Button, Field, Input } from "./ui/primitives";

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
		<form onSubmit={onSubmit} className="flex flex-col gap-4">
			{isSignUp && (
				<Field label="Name" htmlFor="name">
					<Input
						id="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Sam"
						autoComplete="name"
					/>
				</Field>
			)}
			<Field label="Email" htmlFor="email">
				<Input
					id="email"
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					autoComplete="email"
				/>
			</Field>
			<Field label="Password" htmlFor="password">
				<Input
					id="password"
					type="password"
					required
					minLength={8}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="At least 8 characters"
					autoComplete={isSignUp ? "new-password" : "current-password"}
				/>
			</Field>

			{error && (
				<p className="rounded-md border border-spend/25 bg-spend/10 px-3 py-2 text-sm text-spend">
					{error}
				</p>
			)}

			<Button type="submit" disabled={loading} className="mt-1">
				{loading
					? "Please wait…"
					: isSignUp
						? "Create account"
						: "Sign in"}
			</Button>

			<p className="text-center text-sm text-muted-foreground">
				{isSignUp ? "Already have an account? " : "Need an account? "}
				<Link
					href={isSignUp ? "/sign-in" : "/sign-up"}
					className="font-medium text-primary hover:underline"
				>
					{isSignUp ? "Sign in" : "Create one"}
				</Link>
			</p>
		</form>
	);
}
