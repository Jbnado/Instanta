import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input shadcn-style. Altura h-11 (44px) pra atender NFR33 (touch target),
 * mesmos tokens de foco/aria-invalid do button.tsx.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex h-11 w-full rounded-lg border border-input bg-background px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm",
				"placeholder:text-muted-foreground",
				"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
