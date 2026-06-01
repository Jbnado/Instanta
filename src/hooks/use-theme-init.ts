import { useEffect } from "react";

import { applyTheme, useThemeStore } from "@/stores/theme-store";

/**
 * Aplica o tema resolvido ao `<html>` no bootstrap do app.
 *
 * O valor já vem resolvido pelo store (persistido no localStorage ou, na
 * ausência dele, o default de `prefers-color-scheme`). Aplicamos uma vez no
 * mount e em qualquer mudança subsequente de `theme`, mantendo o `<html>`
 * sincronizado com o store.
 *
 * Nota: para eliminar 100% do flash de tema seria ideal um script inline no
 * `index.html` antes da hidratação; mantemos a abordagem mínima client-only
 * conforme a decisão técnica da Story 2.9.
 */
export function useThemeInit(): void {
	const theme = useThemeStore((s) => s.theme);

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);
}
