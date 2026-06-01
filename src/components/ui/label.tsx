import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Label shadcn-style sobre radix-ui. Associa-se ao campo via `htmlFor` e
 * desabilita visualmente quando o controle peer está disabled.
 */
function Label({
	className,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
	return (
		<LabelPrimitive.Root
			data-slot="label"
			className={cn(
				"flex items-center gap-2 text-sm font-medium leading-none select-none",
				"peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
