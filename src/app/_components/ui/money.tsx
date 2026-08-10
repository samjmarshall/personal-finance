import { cn } from "~/lib/utils";
import { formatCurrency } from "~/lib/utils";

export function Money({
	value,
	className,
	colored = false,
	signed = false,
}: {
	value: number | null | undefined;
	className?: string;
	/** Color positive as spend (red) and negative as positive (green). Ledger spend semantics. */
	colored?: boolean;
	signed?: boolean;
}) {
	const v = value ?? 0;
	const display = formatCurrency(Math.abs(v));
	const prefix = signed ? (v < 0 ? "+" : v > 0 ? "−" : "") : "";
	return (
		<span
			className={cn(
				"tabular tracking-tight",
				colored && v > 0 && "text-spend",
				colored && v < 0 && "text-positive",
				className,
			)}
		>
			{prefix}
			{display}
		</span>
	);
}
