import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Botão de logout — Story 2.3.
 *
 * POSTa `/api/auth/logout` (cookies httpOnly via `credentials: 'include'`); o
 * servidor revoga TODAS as sessões ativas do usuário (multi-device, NFR62) e
 * limpa os cookies. Depois redireciona pra home. Sempre renderiza: se ninguém
 * estiver logado, o endpoint responde 401 e o redirect acontece igual — UX simples.
 */
export function LogoutButton() {
	const [busy, setBusy] = useState(false);

	async function onClick() {
		setBusy(true);
		try {
			await fetch("/api/auth/logout", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
			});
		} catch {
			// Mesmo se a rede falhar, o objetivo do usuário é sair: segue pro redirect.
		} finally {
			window.location.assign("/");
		}
	}

	return (
		<Button variant="ghost" size="sm" onClick={onClick} disabled={busy}>
			{busy ? "Saindo…" : "Sair"}
		</Button>
	);
}
