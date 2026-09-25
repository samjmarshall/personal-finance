import { cn, formatCurrency } from "~/lib/utils";

type Tone = "default" | "income" | "spend" | "ledger";

export function Money({
	value,
	className,
	tone = "default",
	signed = false,
}: {
	value: number | null | undefined;
	className?: string;
	/**
	 * - "income": always green
	 * - "spend": always clay-red
	 * - "ledger": positive amount = spend (red), negative = refund (green)
	 * - "default": inherit color
	 */
	tone?: Tone;
	signed?: boolean;
}) {
	const v = value ?? 0;
	const display = formatCurrency(Math.abs(v));
	const prefix = signed ? (v < 0 ? "+" : v > 0 ? "−" : "") : "";

	const toneClass =
		tone === "income"
			? "text-positive"
			: tone === "spend"
				? "text-spend"
				: tone === "ledger"
					? v > 0
						? "text-spend"
						: v < 0
							? "text-positive"
							: "text-muted-foreground"
					: undefined;

	return (
		<span className={cn("tabular tracking-tight", toneClass, className)}>
			{prefix}
			{display}
		</span>
	);
}
