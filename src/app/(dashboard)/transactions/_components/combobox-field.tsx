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

// Primitive values only: rows key by the value's text and match by identity.
export type ComboboxFieldOption<T extends string | number> = {
	value: T;
	label: string;
};

/** Only listed options can be picked (click, Enter, or Tab on typed text). Other or emptied text snaps back on blur; only the X gives `null`. */
export function ComboboxField<T extends string | number>({
	items,
	value,
	onValueChange,
	id,
	className,
	disabled,
	placeholder,
	emptyText,
	label,
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
	/** Names the list and its buttons; two fields in one form need different names. */
	label: string;
	"aria-describedby"?: string;
}) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const highlightedItem = useRef<ComboboxFieldOption<T> | undefined>(undefined);
	const pendingTabPick = useRef<ComboboxFieldOption<T> | null>(null);
	const pickedLabel = items.find((item) => Object.is(item.value, value))?.label;
	// Empty or untouched text is no search.
	const searching = text.trim() !== "" && text !== pickedLabel;
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
		() => (value === null ? null : { value, label: pickedLabel ?? "" }),
		[value, pickedLabel],
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
				pendingTabPick.current = null;
				onValueChange(item?.value ?? null);
			}}
			open={open}
			value={selected}
		>
			<ComboboxInput
				aria-describedby={ariaDescribedBy}
				className={className}
				clearLabel={`Clear ${label}`}
				disabled={disabled}
				id={id}
				onBlur={() => {
					// Pick on blur, not on Tab press: the pick would show the X and focus would land on it.
					if (pendingTabPick.current)
						onValueChange(pendingTabPick.current.value);
					pendingTabPick.current = null;
				}}
				onKeyDown={(e) => {
					// Any key after a Tab means focus stayed, so that Tab pick is stale.
					pendingTabPick.current = null;
					// With the list open, Enter picks or closes; it never saves the form on a typo.
					if (e.key === "Enter" && open) e.preventDefault();
					// With it shut, Escape belongs to the dialog; it must not wipe the pick.
					if (e.key === "Escape" && !open) e.preventBaseUIHandler();
					// Only a typed search lets Tab pick; a stray highlight must not.
					// Ctrl/Alt/Cmd+Tab switches tabs or windows, so it never picks.
					const plainTab =
						e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey;
					if (plainTab && open && searching && highlightedItem.current) {
						pendingTabPick.current = highlightedItem.current;
					}
				}}
				placeholder={placeholder}
				// Hidden mid-search, so a Tab pick moves past it, not onto an X that would undo it.
				showClear={selected !== null && !searching}
				triggerLabel={`Show ${label} options`}
			/>
			<ComboboxContent>
				<ComboboxEmpty>{emptyText}</ComboboxEmpty>
				<ComboboxList aria-label={label}>
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
