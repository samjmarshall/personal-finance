"use client";

import { useMemo, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/ui/combobox";

export type ComboboxFieldOption<T> = { value: T; label: string };

/** Only listed options can be picked; stray text snaps back on blur. Clear gives `null`. */
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
			onOpenChange={(next) => setOpen(next)}
			onValueChange={(item, details) => {
				// Emptied mid-search is a new search: the pick stays, its label returns on close.
				// Shut, no close will bring it back, so empty means cleared.
				if (item === null && details.reason === "input-clear" && open) return;
				onValueChange(item?.value ?? null);
			}}
			value={selected}
		>
			<ComboboxInput
				aria-describedby={ariaDescribedBy}
				className={className}
				clearLabel={clearLabel}
				disabled={disabled}
				id={id}
				onKeyDown={(e) => {
					// With the list open, Enter picks or closes; it never saves the form on a typo.
					if (e.key === "Enter" && open) e.preventDefault();
					// With it shut, Escape belongs to the dialog; it must not wipe the pick.
					if (e.key === "Escape" && !open) e.preventBaseUIHandler();
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
