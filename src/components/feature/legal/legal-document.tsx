import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
	/** Título do documento (ex: "Termos de Uso"). */
	title: string;
	/** Link/affordance de voltar (renderizado no topo). */
	back: ReactNode;
	/** Conteúdo prose do documento (JSX com h2/p/ul/ol). */
	children: ReactNode;
}

/**
 * Layout de leitura compartilhado pelas telas legais (/termos, /privacidade).
 * Mobile-first, container estreito. Como o projeto não tem o plugin de
 * typography do Tailwind, estilizamos os filhos prose via arbitrary variants
 * (`[&_h2]:…`) em vez da classe `prose`.
 */
export function LegalDocument({ title, back, children }: Props) {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
			<header className="space-y-4">
				{back}
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			</header>

			<article
				className={cn(
					"max-w-none text-sm leading-relaxed text-foreground",
					"[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight",
					"[&_p]:my-3 [&_p]:text-muted-foreground",
					"[&_.lead]:text-base [&_.lead]:text-foreground",
					"[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-muted-foreground",
					"[&_ol]:my-3 [&_ol]:list-[lower-alpha] [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:text-muted-foreground",
					"[&_strong]:font-semibold [&_strong]:text-foreground",
					"[&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
					"[&_hr]:my-8 [&_hr]:border-border",
				)}
			>
				{children}
			</article>
		</main>
	);
}
