"use client";

import type { ReactNode } from "react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";

export type SelectFieldOption<T> = {
	value: T;
	label: ReactNode;
	// Native tooltip revealing the full label when the option truncates.
	title?: string;
};

/** `{ value, label }` pairs where each option's label is its own value. */
export function toOptions<T extends string>(
	values: readonly T[],
): SelectFieldOption<T>[] {
	return values.map((value) => ({ value, label: value }));
}

/**
 * Single select over `{ value, label }` options. Passing `items` lets the trigger
 * resolve a value's label without opening the popup — required when a value
 * differs from its label or is `null` (a "clear" option). Pass `value={null}`
 * with a `placeholder` for an unset field with no matching option — Base UI then
 * shows the placeholder (no selected item, so no checkmark).
 */
export function SelectField<T>({
	items,
	value,
	onValueChange,
	id,
	className,
	disabled,
	placeholder,
	"aria-label": ariaLabel,
}: {
	items: readonly SelectFieldOption<T>[];
	value: T | null;
	// Base UI emits null when a null-valued "clear" item is picked; callers
	// without one never receive it but must still accept the type.
	onValueChange: (value: T | null) => void;
	id?: string;
	className?: string;
	disabled?: boolean;
	placeholder?: ReactNode;
	"aria-label"?: string;
}) {
	return (
		<Select
			disabled={disabled}
			items={items}
			onValueChange={onValueChange}
			value={value}
		>
			<SelectTrigger aria-label={ariaLabel} className={className} id={id}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem
						key={String(item.value)}
						title={item.title}
						value={item.value}
					>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
