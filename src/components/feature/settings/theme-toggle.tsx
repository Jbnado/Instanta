import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/stores/theme-store";

/**
 * Botão de alternância de tema (claro/escuro). Lê e escreve no `theme-store`
 * (Zustand + persist → localStorage). Mostra o ícone do tema que será ativado
 * ao clicar (Sol quando está escuro, Lua quando está claro).
 *
 * Acessibilidade: `aria-pressed` reflete se o tema escuro está ativo;
 * `aria-label` em PT-BR descreve a ação de destino.
 */
export function ThemeToggle() {
	const theme = useThemeStore((s) => s.theme);
	const toggleTheme = useThemeStore((s) => s.toggleTheme);

	const isDark = theme === "dark";
	const label = isDark ? "Ativar tema claro" : "Ativar tema escuro";

	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			aria-label={label}
			aria-pressed={isDark}
			title={label}
			onClick={toggleTheme}
		>
			{isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
		</Button>
	);
}
