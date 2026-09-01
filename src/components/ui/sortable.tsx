"use client";

import { useRender } from "@base-ui/react/use-render";
import type {
	DragEndEvent,
	DraggableSyntheticListeners,
	DragStartEvent,
	DropAnimation,
	Modifiers,
	UniqueIdentifier,
} from "@dnd-kit/core";
import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	KeyboardSensor,
	MeasuringStrategy,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { AnimateLayoutChanges } from "@dnd-kit/sortable";
import {
	arrayMove,
	defaultAnimateLayoutChanges,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type * as React from "react";
import type {
	CSSProperties,
	HTMLAttributes,
	ReactElement,
	ReactNode,
} from "react";
import {
	Children,
	cloneElement,
	createContext,
	isValidElement,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/utils";

// Sortable Item Context
const SortableItemContext = createContext<{
	listeners: DraggableSyntheticListeners | undefined;
	isDragging?: boolean;
	disabled?: boolean;
}>({
	listeners: undefined,
	isDragging: false,
	disabled: false,
});

const IsOverlayContext = createContext(false);

const SortableInternalContext = createContext<{
	activeId: UniqueIdentifier | null;
	modifiers?: Modifiers;
}>({
	activeId: null,
	modifiers: undefined,
});

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
	defaultAnimateLayoutChanges({ ...args, wasDragging: true });

const dropAnimationConfig: DropAnimation = {
	sideEffects: defaultDropAnimationSideEffects({
		styles: {
			active: {
				opacity: "0.4",
			},
		},
	}),
};

// Base UI `useRender` equivalent of Radix's Slot: `asChild` merges props onto the
// single child element; otherwise renders a `div`. `ref` merges onto the element too.
type SortableSlotProps = HTMLAttributes<HTMLElement> & {
	asChild?: boolean;
	ref?: React.Ref<HTMLElement>;
	[dataAttribute: `data-${string}`]: unknown;
};

function SortableSlot({
	asChild = false,
	ref,
	children,
	...props
}: SortableSlotProps) {
	return useRender({
		render: asChild ? (Children.only(children) as ReactElement) : undefined,
		ref,
		defaultTagName: "div",
		props: asChild ? props : { ...props, children },
	});
}

// Multipurpose Sortable Component
export interface SortableRootProps<T>
	extends Omit<HTMLAttributes<HTMLDivElement>, "onDragStart" | "onDragEnd"> {
	value: T[];
	onValueChange: (value: T[]) => void;
	getItemValue: (item: T) => string;
	children: ReactNode;
	onMove?: (event: {
		event: DragEndEvent;
		activeIndex: number;
		overIndex: number;
	}) => void;
	strategy?: "horizontal" | "vertical" | "grid";
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	modifiers?: Modifiers;
	asChild?: boolean;
}

function Sortable<T>({
	value,
	onValueChange,
	getItemValue,
	className,
	asChild = false,
	onMove,
	strategy = "vertical",
	onDragStart,
	onDragEnd,
	modifiers,
	children,
	...props
}: SortableRootProps<T>) {
	const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
	const [mounted, setMounted] = useState(false);

	useLayoutEffect(() => setMounted(true), []);

	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: {
				distance: 10,
			},
		}),
		useSensor(TouchSensor, {
			activationConstraint: {
				delay: 250,
				tolerance: 5,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			setActiveId(event.active.id);
			onDragStart?.(event);
		},
		[onDragStart],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;

			setActiveId(null);
			onDragEnd?.(event);

			if (!over) return;

			// Handle item reordering
			const activeIndex = value.findIndex(
				(item: T) => getItemValue(item) === active.id,
			);

			const overIndex = value.findIndex(
				(item: T) => getItemValue(item) === over.id,
			);

			if (activeIndex !== overIndex) {
				if (onMove) {
					onMove({ event, activeIndex, overIndex });
				} else {
					const newValue = arrayMove(value, activeIndex, overIndex);

					onValueChange(newValue);
				}
			}
		},
		[value, getItemValue, onValueChange, onMove, onDragEnd],
	);

	const handleDragCancel = useCallback(() => {
		setActiveId(null);
	}, []);

	const getStrategy = () => {
		switch (strategy) {
			case "horizontal":
				return rectSortingStrategy;
			case "grid":
				return rectSortingStrategy;
			case "vertical":
			default:
				return verticalListSortingStrategy;
		}
	};

	const itemIds = useMemo(() => value.map(getItemValue), [value, getItemValue]);

	const contextValue = useMemo(
		() => ({ activeId, modifiers }),
		[activeId, modifiers],
	);

	// Find the active child for the overlay
	const overlayContent = useMemo(() => {
		if (!activeId) return null;
		let result: ReactNode = null;

		Children.forEach(children, (child) => {
			if (isValidElement(child) && (child.props as any).value === activeId) {
				result = cloneElement(child as ReactElement<any>, {
					...(child.props as any),
					className: cn((child.props as any).className, "z-50"),
				});
			}
		});

		return result;
	}, [activeId, children]);

	return (
		<SortableInternalContext.Provider value={contextValue}>
			<DndContext
				measuring={{
					droppable: {
						strategy: MeasuringStrategy.Always,
					},
				}}
				modifiers={modifiers}
				onDragCancel={handleDragCancel}
				onDragEnd={handleDragEnd}
				onDragStart={handleDragStart}
				sensors={sensors}
			>
				<SortableContext items={itemIds} strategy={getStrategy()}>
					<SortableSlot
						asChild={asChild}
						className={cn(activeId !== null && "cursor-grabbing!", className)}
						data-dragging={activeId !== null}
						data-slot="sortable"
						{...props}
					>
						{children}
					</SortableSlot>
				</SortableContext>
				{mounted &&
					createPortal(
						<DragOverlay
							className={cn("z-50", activeId && "cursor-grabbing")}
							dropAnimation={dropAnimationConfig}
							modifiers={modifiers}
						>
							<IsOverlayContext.Provider value={true}>
								{overlayContent}
							</IsOverlayContext.Provider>
						</DragOverlay>,
						document.body,
					)}
			</DndContext>
		</SortableInternalContext.Provider>
	);
}

export interface SortableItemProps extends HTMLAttributes<HTMLDivElement> {
	value: string;
	disabled?: boolean;
	asChild?: boolean;
}

function SortableItem({
	value,
	className,
	asChild = false,
	disabled,
	children,
	...props
}: SortableItemProps) {
	const isOverlay = useContext(IsOverlayContext);

	const {
		setNodeRef,
		transform,
		transition,
		attributes,
		listeners,
		isDragging: isSortableDragging,
	} = useSortable({
		id: value,
		disabled: disabled || isOverlay,
		animateLayoutChanges,
	});

	if (isOverlay) {
		return (
			<SortableItemContext.Provider
				value={{ listeners: undefined, isDragging: true, disabled: false }}
			>
				<SortableSlot
					asChild={asChild}
					className={cn(className)}
					data-dragging={true}
					data-slot="sortable-item"
					data-value={value}
					{...props}
				>
					{children}
				</SortableSlot>
			</SortableItemContext.Provider>
		);
	}

	const style = {
		transition,
		transform: CSS.Transform.toString(transform),
	} as CSSProperties;

	return (
		<SortableItemContext.Provider
			value={{ listeners, isDragging: isSortableDragging, disabled }}
		>
			<SortableSlot
				asChild={asChild}
				data-disabled={disabled}
				data-dragging={isSortableDragging}
				data-slot="sortable-item"
				data-value={value}
				ref={setNodeRef}
				style={style}
				{...attributes}
				className={cn(
					isSortableDragging && "z-50 opacity-50",
					disabled && "opacity-50",
					className,
				)}
				{...props}
			>
				{children}
			</SortableSlot>
		</SortableItemContext.Provider>
	);
}

export interface SortableItemHandleProps
	extends HTMLAttributes<HTMLDivElement> {
	cursor?: boolean;
	asChild?: boolean;
}

function SortableItemHandle({
	className,
	asChild = false,
	cursor = true,
	children,
	...props
}: SortableItemHandleProps) {
	const { listeners, isDragging, disabled } = useContext(SortableItemContext);

	return (
		<SortableSlot
			asChild={asChild}
			data-disabled={disabled}
			data-dragging={isDragging}
			data-slot="sortable-item-handle"
			{...listeners}
			className={cn(
				cursor && (isDragging ? "cursor-grabbing!" : "cursor-grab!"),
				className,
			)}
			{...props}
		>
			{children}
		</SortableSlot>
	);
}

export interface SortableOverlayProps
	extends Omit<React.ComponentProps<typeof DragOverlay>, "children"> {
	children?: ReactNode | ((params: { value: UniqueIdentifier }) => ReactNode);
}

function SortableOverlay({
	children,
	className,
	...props
}: SortableOverlayProps) {
	const { activeId, modifiers } = useContext(SortableInternalContext);
	const [mounted, setMounted] = useState(false);

	useLayoutEffect(() => setMounted(true), []);

	const content =
		activeId && children
			? typeof children === "function"
				? children({ value: activeId })
				: children
			: null;

	if (!mounted) return null;

	return createPortal(
		<DragOverlay
			className={cn("z-50", activeId && "cursor-grabbing", className)}
			dropAnimation={dropAnimationConfig}
			modifiers={modifiers}
			{...props}
		>
			<IsOverlayContext.Provider value={true}>
				{content}
			</IsOverlayContext.Provider>
		</DragOverlay>,
		document.body,
	);
}

export { Sortable, SortableItem, SortableItemHandle, SortableOverlay };
