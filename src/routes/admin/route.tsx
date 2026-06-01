import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

/**
 * Layout/gate de `/admin` — STUB da Story 2.7/2.8.
 *
 * IMPORTANTE: o gate roda só nas rotas FILHAS que herdam deste layout E que
 * NÃO são as próprias telas de MFA. Pra evitar loop de redirect (o gate manda
 * pra `/admin/mfa-setup`, que herdaria o gate, que mandaria de novo…), as rotas
 * `mfa-setup` e `mfa-verify` curto-circuitam a lógica logo no início do
 * `beforeLoad` (checam só auth + role, sem reavaliar status do MFA).
 *
 * Como TanStack Router roda o `beforeLoad` do pai antes do filho, centralizamos
 * o gate aqui e usamos `location.pathname` pra detectar quando estamos numa tela
 * de MFA — assim o painel (index) recebe o gate completo e o setup/verify ficam
 * sempre alcançáveis.
 *
 * TODO Story 4.1: trocar o `redirect({ to: '/' })` de não-admin por um 404 real
 * via lazy gate (a rota inteira de /admin deve sumir do bundle de não-admins).
 * Por ora redireciona pra home pra não vazar a existência do painel.
 */

interface MeResponse {
	user: {
		id: string;
		email: string;
		displayName: string | null;
		role: string;
	};
}

interface MfaStatusResponse {
	configured: boolean;
	verified: boolean;
}

export const Route = createFileRoute("/admin")({
	beforeLoad: async ({ location }) => {
		// 1) Autenticação: quem é o usuário? 401 → manda pro login.
		let meRes: Response;
		try {
			meRes = await fetch("/api/auth/me", { credentials: "include" });
		} catch {
			// Sem rede / backend fora do ar: trata como não-autenticado.
			throw redirect({ to: "/auth/login" });
		}

		if (meRes.status === 401) {
			throw redirect({ to: "/auth/login" });
		}
		if (!meRes.ok) {
			// Qualquer outro erro inesperado: por segurança, não libera o painel.
			throw redirect({ to: "/auth/login" });
		}

		const me = (await meRes.json()) as MeResponse;

		// 2) Autorização: só admin entra em /admin.
		if (me.user.role !== "admin") {
			// TODO Story 4.1: 404 lazy gate (esconder a rota por completo).
			throw redirect({ to: "/" });
		}

		// 3) Curto-circuito anti-loop: nas próprias telas de MFA, paramos aqui.
		//    Elas precisam ser alcançáveis sem reavaliar o status do MFA (senão o
		//    redirect pra elas dispararia o gate de novo → loop infinito).
		const path = location.pathname;
		const isMfaScreen =
			path.startsWith("/admin/mfa-setup") ||
			path.startsWith("/admin/mfa-verify");
		if (isMfaScreen) {
			return;
		}

		// 4) Gate de MFA (só pro painel e demais rotas internas):
		//    - não configurado → força setup (NFR45).
		//    - configurado mas não verificado nesta sessão → força verify (2.8).
		let statusRes: Response;
		try {
			statusRes = await fetch("/api/auth/mfa/status", {
				credentials: "include",
			});
		} catch {
			// Sem conseguir saber o status, joga pro verify (caminho mais seguro:
			// não libera painel sem 2º fator confirmado).
			throw redirect({ to: "/admin/mfa-verify" });
		}

		if (!statusRes.ok) {
			throw redirect({ to: "/admin/mfa-verify" });
		}

		const status = (await statusRes.json()) as MfaStatusResponse;
		if (!status.configured) {
			throw redirect({ to: "/admin/mfa-setup" });
		}
		if (!status.verified) {
			throw redirect({ to: "/admin/mfa-verify" });
		}
	},
	component: AdminLayout,
});

function AdminLayout() {
	return <Outlet />;
}
