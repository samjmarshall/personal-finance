import { useEffect, useRef } from "react";

// Locking a form disables the field that held focus, which drops focus to body.
// Call the returned function as the submit starts; focus returns to that field
// when the lock lifts (a failed save).
export function useRestoreFocus(locked: boolean) {
	const target = useRef<HTMLElement | null>(null);
	const wasLocked = useRef(false);

	useEffect(() => {
		if (locked) {
			wasLocked.current = true;
			return;
		}
		if (!wasLocked.current) return;
		wasLocked.current = false;
		const field = target.current;
		target.current = null;
		// A saved dialog is closing, so focus belongs to its trigger. Focus the
		// Member moved on purpose is also left alone.
		if (
			field?.isConnected &&
			!field.closest("[data-closed]") &&
			document.activeElement === document.body
		) {
			field.focus();
		}
	}, [locked]);

	return () => {
		target.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
	};
}
