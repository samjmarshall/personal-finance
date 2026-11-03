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
	const [text, setText] = useState("");
	const highlightedItem = useRef<ComboboxFieldOption<T> | undefined>(undefined);
	const pendingTabPick = useRef<ComboboxFieldOption<T> | null>(null);
	const label = items.find((item) => Object.is(item.value, value))?.label;
	// Empty or untouched text is no search.
	const searching = text.trim() !== "" && text !== label;
	// A typed full name lists first, so it is the row lit up and the one Enter
	// or Tab takes ("Fees" over "Bank fees").
	const query = text.trim().toLowerCase();
	const isTypedName = (item: ComboboxFieldOption<T>) =>
		item.label.toLowerCase() === query;
	const listed = searching
		? [...items].sort((a, b) => Number(isTypedName(b)) - Number(isTypedName(a)))
		: items;
	// A new object each render resets half-typed text, so rebuild only on a real change.
	// A saved value missing from a stale list stays picked, nameless, so the X can unlink it.
	const selected = useMemo(
		() => (value === null ? null : { value, label: label ?? "" }),
		[value, label],
	);

	return (
		<Combobox
			autoHighlight
			disabled={disabled}
			isItemEqualToValue={(a, b) => Object.is(a.value, b.value)}
			items={listed}
			onInputValueChange={setText}
			onItemHighlighted={(item) => {
				highlightedItem.current = item;
			}}
			onOpenChange={setOpen}
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
					// Send the Tab pick on blur: sent on keypress, the X it shows would catch the Tab.
					if (pendingTabPick.current)
						onValueChange(pendingTabPick.current.value);
					pendingTabPick.current = null;
				}}
				onKeyDown={(e) => {
					// With the list open, Enter picks or closes; it never saves the form on a typo.
					if (e.key === "Enter" && open) e.preventDefault();
					// With it shut, Escape belongs to the dialog; it must not wipe the pick.
					if (e.key === "Escape" && !open) e.preventBaseUIHandler();
					// Tab takes the highlighted match of a typed search, then moves on.
					// With no search, a stray highlight must not pick.
					if (e.key === "Tab" && open && searching && highlightedItem.current) {
						pendingTabPick.current = highlightedItem.current;
					}
				}}
				placeholder={placeholder}
				// Hidden mid-search, so a Tab pick moves past it, not onto an X that would undo it.
				showClear={selected !== null && !searching}
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
