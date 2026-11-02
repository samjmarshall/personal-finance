"use client";

import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "~/components/ui/combobox";

export type ComboboxFieldOption<T> = { value: T; label: string };

/**
 * Single pick from `{ value, label }` options; typing filters the list.
 * Picks only existing options: unmatched text reverts to the picked label on blur.
 * The clear button emits `null`.
 */
export function ComboboxField<T>({
	items,
	value,
	onValueChange,
	id,
	className,
	disabled,
	placeholder,
	emptyText,
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
	"aria-describedby"?: string;
}) {
	const selected = items.find((item) => Object.is(item.value, value)) ?? null;

	return (
		<Combobox
			autoHighlight
			disabled={disabled}
			isItemEqualToValue={(a, b) => Object.is(a.value, b.value)}
			items={items}
			onValueChange={(item) => onValueChange(item?.value ?? null)}
			value={selected}
		>
			<ComboboxInput
				aria-describedby={ariaDescribedBy}
				className={className}
				disabled={disabled}
				id={id}
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
