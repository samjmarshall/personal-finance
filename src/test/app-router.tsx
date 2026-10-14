import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	AppRouterContext,
	type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { vi } from "vitest";

/** Test wrapper: fake router so Next's error retry hits a spy, plus the app's query client. */
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
	const queryClient = new QueryClient();

	function AppRouter({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<AppRouterContext value={router}>{children}</AppRouterContext>
			</QueryClientProvider>
		);
	}

	return { router, AppRouter };
}
