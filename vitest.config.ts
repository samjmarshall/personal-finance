import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		// Scoped to src/ so .claude/skills/**/*.test.ts stays with node:test, which
		// vitest would otherwise collect and fail on.
		include: ["src/**/*.test.ts"],
	},
});
