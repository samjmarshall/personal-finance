"use client";

import type { ReactNode } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";

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
	loading = false,
	readOnly,
	placeholder,
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedBy,
}: {
	items: readonly SelectFieldOption<T>[];
	value: T | null;
	// Base UI emits null when a null-valued "clear" item is picked; callers
	// without one never receive it but must still accept the type.
	onValueChange: (value: T | null) => void;
	id?: string;
	className?: string;
	disabled?: boolean;
	// A save is running for this field: locks it and shows a spinner in the trigger.
	loading?: boolean;
	// Stays focusable, unlike `disabled`, so its description is still read.
	readOnly?: boolean;
	placeholder?: ReactNode;
	"aria-label"?: string;
	"aria-describedby"?: string;
}) {
	return (
		<Select
			disabled={disabled || loading}
			items={items}
			onOpenChange={(open, eventDetails) => {
				// Base UI lets a read-only popup open for browsing, but its options
				// look pickable and do nothing — keep it shut instead.
				if (open && readOnly) eventDetails.cancel();
			}}
			onValueChange={onValueChange}
			readOnly={readOnly}
			value={value}
		>
			<SelectTrigger
				aria-busy={loading || undefined}
				aria-describedby={ariaDescribedBy}
				aria-label={ariaLabel}
				className={className}
				id={id}
			>
				<SelectValue placeholder={placeholder} />
				{loading && <Spinner className="text-muted-foreground" />}
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
