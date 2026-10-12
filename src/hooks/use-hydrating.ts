import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

// True on the server and while hydrating; false at once when first mounted on
// the client. SSR-safe primitive, so adr001 allows it.
export function useHydrating() {
	return useSyncExternalStore(
		subscribeNever,
		() => false,
		() => true,
	);
}
