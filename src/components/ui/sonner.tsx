"use client";

import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useMounted } from "~/hooks/use-mounted";

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();
	// theme is the SSR default until mount; gate it so the first client render
	// matches server HTML and sonner's container doesn't hydration-mismatch.
	const mounted = useMounted();
	return (
		<Sonner
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
				} as CSSProperties
			}
			theme={mounted ? (theme as ToasterProps["theme"]) : "system"}
			{...props}
		/>
	);
};

export { Toaster };
