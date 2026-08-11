import * as React from "react";
import { cn } from "~/lib/utils";

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
