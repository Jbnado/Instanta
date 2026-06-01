import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Checkbox shadcn-style sobre radix-ui. Segue as convenções do button.tsx:
 * `data-slot`, tokens de tema (border/ring/primary), foco acessível e estado
 * aria-invalid. Touch target 44px garantido via wrapper de label no form.
 */
function Checkbox({
	className,
	...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer size-5 shrink-0 rounded-[6px] border border-input bg-background outline-none transition-shadow",
				"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
				"data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex items-center justify-center text-current"
			>
				<Check className="size-3.5" strokeWidth={3} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
