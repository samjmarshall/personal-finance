"use client";

import { useMemo, useRef, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/ui/combobox";

export type ComboboxFieldOption<T> = { value: T; label: string };

/** Only listed options can be picked (click, Enter, or Tab on typed text). Other or emptied text snaps back on blur; only the X gives `null`. */
export function ComboboxField<T>({
	items,
	value,
	onValueChange,
	id,
	className,
	disabled,
	placeholder,
	emptyText,
	clearLabel,
	"aria-describedby": ariaDescribedBy,
}: {
	items: readonly ComboboxFieldOption<T>[];
	value: T | null;
	onValueChange: (value: T | null) => void;
	id?: string;
	className?: string;
	disabled?: boolean;
	placeholder?: string;
	emptyText: string;
	/** Names the X; two fields in one form need different names. */
	clearLabel?: string;
	"aria-describedby"?: string;
}) {
	const [open, setOpen] = useState(false);
	const highlighted = useRef<ComboboxFieldOption<T> | undefined>(undefined);
	const highlightedByKeys = useRef(false);
	const tabPick = useRef<ComboboxFieldOption<T> | null>(null);
	const label = items.find((item) => Object.is(item.value, value))?.label;
	// A new object each render resets half-typed text, so rebuild only on a real change.
	const selected = useMemo(
		() => (value === null || label === undefined ? null : { value, label }),
		[value, label],
	);

	return (
		<Combobox
			autoHighlight
			disabled={disabled}
			isItemEqualToValue={(a, b) => Object.is(a.value, b.value)}
			items={items}
			onItemHighlighted={(item, details) => {
				highlighted.current = item;
				highlightedByKeys.current = details.reason === "keyboard";
			}}
			onOpenChange={(next) => setOpen(next)}
			onValueChange={(item, details) => {
				// Emptied text is a new search, not a clear: the pick stays and its
				// label returns when the list closes. Only the X clears.
				if (item === null && details.reason === "input-clear") {
					setOpen(true);
					return;
				}
				onValueChange(item?.value ?? null);
			}}
			open={open}
			value={selected}
		>
			<ComboboxInput
				aria-describedby={ariaDescribedBy}
				className={className}
				clearLabel={clearLabel}
				disabled={disabled}
				id={id}
				onBlur={() => {
					// Picked on Tab but sent only now: sent sooner, the X it shows grabs the Tab.
					if (tabPick.current) onValueChange(tabPick.current.value);
					tabPick.current = null;
				}}
				onKeyDown={(e) => {
					// With the list open, Enter picks or closes; it never saves the form on a typo.
					if (e.key === "Enter" && open) e.preventDefault();
					// With it shut, Escape belongs to the dialog; it must not wipe the pick.
					if (e.key === "Escape" && !open) e.preventBaseUIHandler();
					// Tab takes the highlighted match of a typed search, then moves on.
					// Empty or untouched text is no search, so a stray highlight must not pick.
					const text = e.currentTarget.value;
					const searching = text.trim() !== "" && text !== label;
					if (e.key === "Tab" && open && searching && highlighted.current) {
						// A typed full name beats a longer match listed above it ("Fees" vs
						// "Bank fees"), but not a row the arrow keys picked, as Enter would take it.
						const exact = highlightedByKeys.current
							? undefined
							: items.find(
									(item) =>
										item.label.toLowerCase() === text.trim().toLowerCase(),
								);
						tabPick.current = exact ?? highlighted.current;
					}
				}}
				placeholder={placeholder}
				showClear={selected !== null}
			/>
			<ComboboxContent>
				<ComboboxEmpty>{emptyText}</ComboboxEmpty>
				<ComboboxList>
					{(item: ComboboxFieldOption<T>) => (
						<ComboboxItem key={String(item.value)} value={item}>
							{item.label}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
