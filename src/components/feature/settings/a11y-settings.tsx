import { ThemeToggle } from "@/components/feature/settings/theme-toggle";

/**
 * Painel de configurações de acessibilidade (A11ySettings).
 *
 * Container enxuto da Story 2.9 — por ora hospeda só o toggle de tema
 * (claro/escuro). Stories posteriores expandem com outras preferências
 * (tamanho de fonte, reduzir movimento, etc.).
 */
export function A11ySettings() {
	return (
		<section aria-label="Configurações de acessibilidade" className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm font-medium">Tema (claro/escuro)</span>
				<ThemeToggle />
			</div>
		</section>
	);
}
