import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MfaVerify } from "@/components/feature/mfa/mfa-verify";

/**
 * Tela de verificação do MFA (Story 2.8). Herda o gate de auth+role do layout
 * `/admin` (route.tsx), que curto-circuita aqui pra não reavaliar o status do
 * MFA (evita loop com o redirect que trouxe pra cá).
 */
export const Route = createFileRoute("/admin/mfa-verify")({
	component: MfaVerifyPage,
});

function MfaVerifyPage() {
	const navigate = useNavigate();

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
			<header className="space-y-1.5 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					Verificação em 2 etapas
				</h1>
				<p className="text-sm text-muted-foreground">
					Abra seu app authenticator e digite o código atual pra continuar.
				</p>
			</header>

			<MfaVerify onVerified={() => navigate({ to: "/admin" })} />
		</main>
	);
}
