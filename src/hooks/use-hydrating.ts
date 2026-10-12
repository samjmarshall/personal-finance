import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

// True on the server and while hydrating. Unlike the mounted flag, false from the
// first render when mounted on the client. SSR-safety primitive, so adr001 allows it.
export function useHydrating() {
	return useSyncExternalStore(
		subscribeNever,
		() => false,
		() => true,
	);
}
