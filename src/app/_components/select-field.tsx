"use client";

import type { ReactNode } from "react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";

export type SelectFieldOption<T> = { value: T; label: ReactNode };

/** `{ value, label }` pairs where each option's label is its own value. */
export function toOptions<T extends string>(
	values: readonly T[],
): SelectFieldOption<T>[] {
	return values.map((value) => ({ value, label: value }));
}

/**
 * Single select over `{ value, label }` options. Passing `items` lets the trigger
 * resolve a value's label without opening the popup — required when a value
 * differs from its label or is `null` (a "clear" option).
 */
export function SelectField<T>({
	items,
	value,
	onValueChange,
	id,
	className,
	disabled,
	"aria-label": ariaLabel,
}: {
	items: readonly SelectFieldOption<T>[];
	value: T;
	// Base UI emits null when a null-valued "clear" item is picked; callers
	// without one never receive it but must still accept the type.
	onValueChange: (value: T | null) => void;
	id?: string;
	className?: string;
	disabled?: boolean;
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
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={String(item.value)} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
