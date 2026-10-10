import {
	AppRouterContext,
	type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * Stands in for the App Router context Next mounts around the app, so
 * `catchError`'s `retry()` reaches `router.refresh()`. Pass `AppRouter` as
 * Testing Library's `wrapper` and assert on the `router` spies.
 */
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
