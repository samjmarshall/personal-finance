import { useEffect, useState } from "react";

// True after the first client render, false on the server and initial paint.
// SSR-safety primitive — an independent per-caller flag, not the page/modal
// state adr001 keeps out of custom hooks — so a component can render
// server-matching output first, then a client-only branch once mounted.
export function useMounted() {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted;
}
