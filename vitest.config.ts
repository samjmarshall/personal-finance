import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		// Unit tests exercise units in isolation, not the runtime env contract — and
		// modules like the logger now import ~/env, whose validation would otherwise
		// throw here (e.g. DATABASE_URL unset). Skip it so a bare `make test` needs no
		// real env; the schema is still enforced at build/boot.
		env: { SKIP_ENV_VALIDATION: "1" },
		// Auto-restore vi.stubEnv before each test so a stubbed env can't leak into
		// the next one and make a test's result depend on run order.
		unstubEnvs: true,
		// Scoped to src/ so .claude/skills/**/*.test.ts stays with node:test, which
		// vitest would otherwise collect and fail on. Split by extension: node vs jsdom.
		projects: [
			{
				test: {
					name: "unit",
					environment: "node",
					include: ["src/**/*.test.ts"],
				},
			},
			{
				test: {
					name: "component",
					environment: "jsdom",
					include: ["src/**/*.test.tsx"],
					setupFiles: ["./src/test/setup-dom.ts"],
				},
			},
		],
	},
});
