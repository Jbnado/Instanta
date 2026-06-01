import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MfaSetup } from "@/components/feature/mfa/mfa-setup";

/**
 * Tela de setup do MFA (Story 2.7). Herda o gate de auth+role do layout
 * `/admin` (route.tsx), mas o gate curto-circuita aqui pra NÃO reavaliar o
 * status do MFA (senão geraria loop com o próprio redirect que trouxe pra cá).
 */
export const Route = createFileRoute("/admin/mfa-setup")({
	component: MfaSetupPage,
});

function MfaSetupPage() {
	const navigate = useNavigate();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Configurar verificação em 2 etapas
				</h1>
				<p className="text-sm text-muted-foreground">
					Sua conta admin exige um 2º fator. Vamos configurar agora.
				</p>
			</header>

			<MfaSetup onConfirmed={() => navigate({ to: "/admin" })} />
		</main>
	);
}
