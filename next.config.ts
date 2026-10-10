import type { NextConfig } from "next";
import "~/env";

const config: NextConfig = {
	// Portless serves the dev app from https://personal-finance.localhost (and
	// <branch>.personal-finance.localhost per worktree) — a different origin than the
	// localhost:PORT the dev server binds, so Next must trust it.
	allowedDevOrigins: [
		"personal-finance.localhost",
		"*.personal-finance.localhost",
	],
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{ key: "X-Frame-Options", value: "SAMEORIGIN" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
					{
						key: "Strict-Transport-Security",
						value: "max-age=63072000; includeSubDomains",
					},
				],
			},
			// Config headers beat the ones a route sets, and the last match wins, so the
			// sandboxed e-receipt body (adr019) needs its own entry to send no referrer.
			{
				source: "/api/receipts/:id/html",
				headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
			},
		];
	},
};

export default config;
