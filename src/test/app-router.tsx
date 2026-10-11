import {
	AppRouterContext,
	type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { vi } from "vitest";

/** Fake App Router context so Next's error-boundary retry reaches a refresh spy. Use `AppRouter` as the render wrapper. */
export function createAppRouter() {
	const router = {
		back: vi.fn(),
		forward: vi.fn(),
		refresh: vi.fn(),
		push: vi.fn(),
		replace: vi.fn(),
		prefetch: vi.fn(),
		bfcacheId: "test",
	} satisfies AppRouterInstance;

	function AppRouter({ children }: { children: ReactNode }) {
		return <AppRouterContext value={router}>{children}</AppRouterContext>;
	}

	return { router, AppRouter };
}
