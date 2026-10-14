import { Loader2Icon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

// Decorative, not a status region: callers wrap it if they need an announcement.
// Sized by attribute so the button's size styles still apply.
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
