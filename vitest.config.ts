import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		// Unit tests exercise units in isolation, not the runtime env contract — and
		// modules like the logger now import ~/env, whose validation would otherwise
		// throw here (e.g. DATABASE_URL unset). Skip it so a bare `make test` needs no
		// real env; the schema is still enforced at build/boot.
		env: { SKIP_ENV_VALIDATION: "1" },
		// Scoped to src/ so .claude/skills/**/*.test.ts stays with node:test, which
		// vitest would otherwise collect and fail on.
		include: ["src/**/*.test.ts"],
	},
});
