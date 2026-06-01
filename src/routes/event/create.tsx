import { createFileRoute, redirect } from "@tanstack/react-router";

import { CreateEventForm } from "@/components/feature/event/create-event-form";

/**
 * Tela de criação de evento (Story 3.1). Rota auth-gated: só anfitrião logado
 * entra. O gate espelha o `beforeLoad` de `/admin` (GET /api/auth/me → 401 manda
 * pro login), mas sem o gate de MFA — criar evento não exige 2º fator.
 */

interface MeResponse {
	user: {
		id: string;
		email: string;
		displayName: string | null;
		role: string;
	};
}

export const Route = createFileRoute("/event/create")({
	beforeLoad: async () => {
		let meRes: Response;
		try {
			meRes = await fetch("/api/auth/me", { credentials: "include" });
		} catch {
			// Sem rede / backend fora do ar: trata como não-autenticado.
			throw redirect({ to: "/auth/login" });
		}

		if (meRes.status === 401 || !meRes.ok) {
			throw redirect({ to: "/auth/login" });
		}

		// Consome o corpo pra liberar a conexão (não precisamos do payload aqui).
		await meRes.json().catch(() => null as MeResponse | null);
	},
	component: CreateEventPage,
});

function CreateEventPage() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
			<header className="space-y-1.5">
				<h1 className="text-2xl font-semibold tracking-tight">Criar evento</h1>
				<p className="text-sm text-muted-foreground">
					Monte o setup. O evento nasce inativo — você ativa quando quiser e aí
					sai o QR Code pros convidados.
				</p>
			</header>

			<CreateEventForm />
		</main>
	);
}
