import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

const STORAGE_KEY = "instanta-theme";

/**
 * Lê a preferência de tema do SO via `prefers-color-scheme`.
 * Usado como default no primeiro acesso (FR48, NFR36, UX-DR5), quando ainda
 * não há valor persistido no localStorage. SSR-safe: sem `window`, assume light.
 */
export function getSystemTheme(): Theme {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return "light";
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Aplica o tema ao `<html>` adicionando/removendo a classe `.dark`.
 * O Tailwind v4 deste projeto usa `@custom-variant dark (&:is(.dark *))`
 * (ver src/react-app/index.css), então o toggle manual é puramente via classe.
 *
 * INVARIANTE DO TELÃO: o telão (slideshow, epic posterior — ainda não existe)
 * deve sempre ter fundo neutro/preto INDEPENDENTE do tema do app (NFR36).
 * Quando o telão for implementado, ele NÃO deve herdar `.dark`/light daqui —
 * força seu próprio fundo escuro localmente.
 */
export function applyTheme(theme: Theme): void {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set, get) => ({
			// Default computado no primeiro acesso; sobrescrito pelo valor
			// persistido quando ele existir (merge do persist middleware).
			theme: getSystemTheme(),
			setTheme: (theme) => {
				applyTheme(theme);
				set({ theme });
			},
			toggleTheme: () => {
				const next: Theme = get().theme === "dark" ? "light" : "dark";
				applyTheme(next);
				set({ theme: next });
			},
		}),
		{
			name: STORAGE_KEY,
			// Reaplica o tema ao `<html>` quando o estado é reidratado do
			// localStorage (fallback do AC), garantindo consistência visual.
			onRehydrateStorage: () => (state) => {
				if (state) applyTheme(state.theme);
			},
		},
	),
);
