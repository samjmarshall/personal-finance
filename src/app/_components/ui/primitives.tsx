import * as React from "react";
import { cn } from "~/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
	size?: "sm" | "md" | "icon";
};

export function Button({
	className,
	variant = "primary",
	size = "md",
	...props
}: ButtonProps) {
	const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
		primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
		secondary: "bg-muted text-foreground hover:bg-muted/70",
		outline: "border border-border bg-card text-foreground hover:bg-muted/60",
		ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
		danger: "bg-spend text-spend-foreground hover:bg-spend/90 shadow-sm",
	};
	const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
		sm: "h-8 px-3 text-sm gap-1.5",
		md: "h-10 px-4 text-sm gap-2",
		icon: "h-9 w-9",
	};
	return (
		<button
			className={cn(
				"inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		/>
	);
}

export const Input = React.forwardRef<
	HTMLInputElement,
	React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
	return (
		<input
			className={cn(
				"h-10 w-full rounded-md border border-input bg-card px-3 text-foreground text-sm placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			ref={ref}
			{...props}
		/>
	);
});

export const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
	return (
		<textarea
			className={cn(
				"min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			ref={ref}
			{...props}
		/>
	);
});

export const Select = React.forwardRef<
	HTMLSelectElement,
	React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
	return (
		<select
			className={cn(
				"h-10 w-full appearance-none rounded-md border border-input bg-[length:1rem] bg-[right_0.6rem_center] bg-card bg-no-repeat px-3 pr-9 text-foreground text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				className,
			)}
			ref={ref}
			style={{
				backgroundImage:
					"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
			}}
			{...props}
		>
			{children}
		</select>
	);
});

export function Field({
	label,
	htmlFor,
	children,
	className,
	hint,
	optional,
}: {
	label: string;
	htmlFor?: string;
	children: React.ReactNode;
	className?: string;
	hint?: string;
	optional?: boolean;
}) {
	return (
		<label className={cn("flex flex-col gap-1.5", className)} htmlFor={htmlFor}>
			<span className="flex items-baseline justify-between gap-2">
				<span className="font-medium text-muted-foreground text-xs">
					{label}
				</span>
				{optional && (
					<span className="text-[0.65rem] text-muted-foreground/60">
						Optional
					</span>
				)}
			</span>
			{children}
			{hint && (
				<span className="text-[0.65rem] text-muted-foreground/60 leading-tight">
					{hint}
				</span>
			)}
		</label>
	);
}

export function Badge({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-xs",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function Card({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"rounded-xl border border-border bg-card shadow-[0_1px_2px_oklch(0.2_0.02_255/0.04)]",
				className,
			)}
		>
			{children}
		</div>
	);
}
