"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Theme is an allowed global provider under adr001. `attribute="class"` drives
// the `.dark` class the `@custom-variant dark` in globals.css keys off of.
export function ThemeProvider({
	children,
	...props
}: ComponentProps<typeof NextThemesProvider>) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			enableSystem
			{...props}
		>
			{children}
		</NextThemesProvider>
	);
}
