import { Loader2Icon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

// Decorative, unlike the registry's role="status" version: a caller that needs
// an announcement wraps it in its own status region. Sized by attribute, not a
// size-* class, so Button's per-size svg rule still sizes it.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
	return (
		<Loader2Icon
			aria-hidden
			className={cn("animate-spin motion-reduce:animate-none", className)}
			data-slot="spinner"
			size={16}
			{...props}
		/>
	);
}

export { Spinner };
