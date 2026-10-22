import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	AppRouterContext,
	type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { vi } from "vitest";

// Set by the latest createAppRouter(); AppRouter lives at module level so React keeps one component.
let current: { router: AppRouterInstance; queryClient: QueryClient };

function AppRouter({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={current.queryClient}>
			<AppRouterContext value={current.router}>{children}</AppRouterContext>
		</QueryClientProvider>
	);
}

/** Test wrapper: fake router so Next's error retry hits a spy, plus the app's query client. One per test. */
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
	current = { router, queryClient: new QueryClient() };

	return { router, AppRouter };
}
