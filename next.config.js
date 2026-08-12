import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
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
		];
	},
};

export default config;
