import type * as React from "react";

import { cn } from "~/lib/utils";

const skeletonClassName =
	"animate-pulse rounded-md bg-muted motion-reduce:animate-none";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			aria-hidden
			className={cn(skeletonClassName, className)}
			data-slot="skeleton"
			{...props}
		/>
	);
}

export { Skeleton, skeletonClassName };
